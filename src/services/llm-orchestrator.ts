import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { featureFlags } from '../utils/feature-flags';
import { auditLogger } from '../utils/audit-logger';

export interface LLMRequest {
  prompt: string;
  provider?: 'rocket' | 'chatgpt' | 'claude' | 'local';
  max_tokens?: number;
  temperature?: number;
  cache_ttl?: number;
}

export interface LLMResponse {
  content: string;
  provider: string;
  tokens_used: number;
  cost: number;
  cached: boolean;
  generated_at: string;
}

export interface LLMProvider {
  name: string;
  endpoint: string;
  api_key: string;
  cost_per_token: number;
  max_tokens: number;
  enabled: boolean;
}

class LLMOrchestrator {
  private providers: Map<string, LLMProvider> = new Map();
  private cache: Map<string, any> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    this.providers.set('rocket', {
      name: 'Rocket AI',
      endpoint: 'https://api.rocket.ai/v1/generate',
      api_key: process.env.ROCKET_API_KEY || '{{API_KEY}}',
      cost_per_token: 0.0001,
      max_tokens: 4000,
      enabled: true
    });

    this.providers.set('chatgpt', {
      name: 'ChatGPT Pro',
      endpoint: 'https://api.openai.com/v1/chat/completions',
      api_key: process.env.OPENAI_API_KEY || '{{API_KEY}}',
      cost_per_token: 0.0015,
      max_tokens: 4000,
      enabled: true
    });

    this.providers.set('claude', {
      name: 'Claude',
      endpoint: 'https://api.anthropic.com/v1/messages',
      api_key: process.env.ANTHROPIC_API_KEY || '{{API_KEY}}',
      cost_per_token: 0.0008,
      max_tokens: 8000,
      enabled: true
    });

    this.providers.set('local', {
      name: 'Local LLM',
      endpoint: 'http://localhost:11434/api/generate',
      api_key: '',
      cost_per_token: 0.0,
      max_tokens: 2000,
      enabled: false
    });
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!await featureFlags.isEnabled('llm_orchestration')) {
      throw new Error('LLM orchestration is disabled');
    }

    const provider = this.selectProvider(request);
    const cacheKey = this.generateCacheKey(request);
    
    // Check cache first
    if (request.cache_ttl && request.cache_ttl > 0) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expires_at > Date.now()) {
        return {
          ...cached.response,
          cached: true
        };
      }
    }

    // Sanitize prompt
    const sanitizedPrompt = this.sanitizePrompt(request.prompt);
    
    try {
      const response = await this.callProvider(provider, {
        ...request,
        prompt: sanitizedPrompt
      });

      // Cache response if TTL specified
      if (request.cache_ttl && request.cache_ttl > 0) {
        this.cache.set(cacheKey, {
          response,
          expires_at: Date.now() + (request.cache_ttl * 1000)
        });
      }

      // Detect hallucinations
      const hallucinationScore = await this.detectHallucination(response.content);
      if (hallucinationScore > 0.8) {
        console.warn('High hallucination score detected:', hallucinationScore);
      }

      return {
        ...response,
        cached: false
      };
    } catch (error) {
      // Fallback to next available provider
      const fallbackProvider = this.selectFallbackProvider(provider.name);
      if (fallbackProvider) {
        return this.callProvider(fallbackProvider, request);
      }
      throw error;
    }
  }

  private selectProvider(request: LLMRequest): LLMProvider {
    const preferredProvider = request.provider || 'rocket';
    const provider = this.providers.get(preferredProvider);
    
    if (!provider || !provider.enabled) {
      // Fallback to first available provider
      for (const [, p] of this.providers) {
        if (p.enabled) return p;
      }
      throw new Error('No LLM providers available');
    }
    
    return provider;
  }

  private selectFallbackProvider(excludeProvider: string): LLMProvider | null {
    for (const [name, provider] of this.providers) {
      if (name !== excludeProvider && provider.enabled) {
        return provider;
      }
    }
    return null;
  }

  private async callProvider(provider: LLMProvider, request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();
    
    // Provider-specific request formatting
    let requestBody: any;
    let headers: any = {
      'Content-Type': 'application/json'
    };

    switch (provider.name) {
      case 'Rocket AI':
        requestBody = {
          prompt: request.prompt,
          max_tokens: request.max_tokens || 1000,
          temperature: request.temperature || 0.7
        };
        headers['Authorization'] = `Bearer ${provider.api_key}`;
        break;
        
      case 'ChatGPT Pro':
        requestBody = {
          model: 'gpt-4',
          messages: [{ role: 'user', content: request.prompt }],
          max_tokens: request.max_tokens || 1000,
          temperature: request.temperature || 0.7
        };
        headers['Authorization'] = `Bearer ${provider.api_key}`;
        break;
        
      case 'Claude':
        requestBody = {
          model: 'claude-3-sonnet-20240229',
          max_tokens: request.max_tokens || 1000,
          messages: [{ role: 'user', content: request.prompt }]
        };
        headers['x-api-key'] = provider.api_key;
        headers['anthropic-version'] = '2023-06-01';
        break;
        
      default:
        throw new Error(`Unsupported provider: ${provider.name}`);
    }

    const response = await fetch(provider.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`Provider ${provider.name} returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const endTime = Date.now();
    
    // Extract content based on provider response format
    let content: string;
    let tokensUsed: number;
    
    switch (provider.name) {
      case 'Rocket AI':
        content = data.text || data.content || '';
        tokensUsed = data.usage?.total_tokens || 0;
        break;
        
      case 'ChatGPT Pro':
        content = data.choices?.[0]?.message?.content || '';
        tokensUsed = data.usage?.total_tokens || 0;
        break;
        
      case 'Claude':
        content = data.content?.[0]?.text || '';
        tokensUsed = data.usage?.input_tokens + data.usage?.output_tokens || 0;
        break;
        
      default:
        content = data.content || '';
        tokensUsed = 0;
    }

    const cost = tokensUsed * provider.cost_per_token;

    // Log usage for monitoring
    await auditLogger.log({
      trace_id: uuidv4(),
      action: 'llm.generate',
      entity_type: 'llm_request',
      entity_id: provider.name,
      payload_hash: crypto.createHash('sha256').update(request.prompt).digest('hex').substring(0, 16)
    });

    return {
      content,
      provider: provider.name,
      tokens_used: tokensUsed,
      cost,
      cached: false,
      generated_at: new Date().toISOString()
    };
  }

  private generateCacheKey(request: LLMRequest): string {
    const key = `${request.provider || 'default'}_${request.prompt}_${request.max_tokens || 1000}_${request.temperature || 0.7}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  private sanitizePrompt(prompt: string): string {
    // Remove potential injection attempts
    return prompt
      .replace(/\b(ignore|forget|disregard)\s+(previous|above|all)\s+(instructions|prompts?)/gi, '[FILTERED]')
      .replace(/\b(system|admin|root)\s+(prompt|instruction)/gi, '[FILTERED]')
      .substring(0, 8000); // Limit prompt length
  }

  private async detectHallucination(content: string): Promise<number> {
    // Simple heuristic-based hallucination detection
    let score = 0;
    
    // Check for contradictory statements
    if (content.includes('definitely') && content.includes('maybe')) score += 0.3;
    
    // Check for impossible claims
    if (/\b(always|never)\b.*\b(sometimes|occasionally)\b/i.test(content)) score += 0.4;
    
    // Check for excessive certainty with vague information
    if ((content.match(/\b(certainly|definitely|absolutely)\b/gi) || []).length > 3) score += 0.2;
    
    return Math.min(score, 1.0);
  }

  // REST API endpoints
  async handleGenerate(req: Request, res: Response): Promise<void> {
    const traceId = req.headers['x-trace-id'] as string || uuidv4();
    
    try {
      const request: LLMRequest = req.body;
      const response = await this.generate(request);
      
      res.json(response);
    } catch (error) {
      res.status(500).json({
        error: {
          code: 'LLM_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          trace_id: traceId
        }
      });
    }
  }

  async handleExtract(req: Request, res: Response): Promise<void> {
    const traceId = req.headers['x-trace-id'] as string || uuidv4();
    
    try {
      const { text, schema } = req.body;
      
      const prompt = `Extract structured data from the following text according to this schema: ${JSON.stringify(schema)}\n\nText: ${text}\n\nReturn only valid JSON:`;
      
      const response = await this.generate({
        prompt,
        provider: 'local', // Use local LLM for cheap extraction
        max_tokens: 1000,
        temperature: 0.1
      });
      
      try {
        const extracted = JSON.parse(response.content);
        res.json({ extracted, metadata: response });
      } catch (parseError) {
        res.status(400).json({
          error: {
            code: 'INVALID_JSON',
            message: 'Failed to parse extracted data as JSON',
            trace_id: traceId
          }
        });
      }
    } catch (error) {
      res.status(500).json({
        error: {
          code: 'EXTRACTION_ERROR',
          message: error instanceof Error ? error.message : 'Unknown error',
          trace_id: traceId
        }
      });
    }
  }
}

export const llmOrchestrator = new LLMOrchestrator();
export default LLMOrchestrator;

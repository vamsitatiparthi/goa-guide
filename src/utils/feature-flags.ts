import { auditLogger } from './audit-logger';

export interface FeatureFlag {
  flag_name: string;
  enabled: boolean;
  description: string;
  conditions: Record<string, any>;
  created_at: string;
  updated_at: string;
  updated_by?: string;
}

class FeatureFlagService {
  private flags: Map<string, FeatureFlag> = new Map();
  private initialized = false;

  constructor() {
    this.initializeFlags();
  }

  private initializeFlags(): void {
    // Default feature flags as per requirements
    const defaultFlags: FeatureFlag[] = [
      {
        flag_name: 'events_ingest',
        enabled: true,
        description: 'Enable event data ingestion',
        conditions: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        flag_name: 'provider_rfp',
        enabled: true,
        description: 'Enable provider RFP system',
        conditions: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        flag_name: 'auto_book',
        enabled: false,
        description: 'Enable automatic booking confirmation',
        conditions: { user_tier: 'premium' },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        flag_name: 'adventure_validator',
        enabled: true,
        description: 'Enable adventure photo validation',
        conditions: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        flag_name: 'photo_verification',
        enabled: true,
        description: 'Enable photo authenticity checks',
        conditions: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        flag_name: 'llm_orchestration',
        enabled: true,
        description: 'Enable LLM orchestrator service',
        conditions: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        flag_name: 'audit_logging',
        enabled: true,
        description: 'Enable audit logging',
        conditions: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        flag_name: 'api_gateway',
        enabled: true,
        description: 'Enable API gateway features',
        conditions: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ];

    defaultFlags.forEach(flag => {
      this.flags.set(flag.flag_name, flag);
    });

    this.initialized = true;
  }

  async isEnabled(flagName: string, context?: Record<string, any>): Promise<boolean> {
    if (!this.initialized) {
      await this.loadFromDatabase();
    }

    const flag = this.flags.get(flagName);
    if (!flag) {
      console.warn(`Feature flag '${flagName}' not found, defaulting to false`);
      return false;
    }

    if (!flag.enabled) {
      return false;
    }

    // Check conditions if provided
    if (flag.conditions && Object.keys(flag.conditions).length > 0 && context) {
      return this.evaluateConditions(flag.conditions, context);
    }

    return true;
  }

  async updateFlag(flagName: string, enabled: boolean, updatedBy?: string): Promise<void> {
    const flag = this.flags.get(flagName);
    if (!flag) {
      throw new Error(`Feature flag '${flagName}' not found`);
    }

    const oldValue = flag.enabled;
    flag.enabled = enabled;
    flag.updated_at = new Date().toISOString();
    flag.updated_by = updatedBy;

    // Audit the change
    await auditLogger.log({
      trace_id: `flag_${Date.now()}`,
      action: 'feature_flag.updated',
      entity_type: 'feature_flag',
      entity_id: flagName,
      user_id: updatedBy,
      payload_hash: `${oldValue}_to_${enabled}`
    });

    // In production, persist to database
    // await db.feature_flags.update(flagName, flag);
  }

  async getAllFlags(): Promise<FeatureFlag[]> {
    if (!this.initialized) {
      await this.loadFromDatabase();
    }
    return Array.from(this.flags.values());
  }

  getSnapshot(): Record<string, boolean> {
    const snapshot: Record<string, boolean> = {};
    for (const [name, flag] of this.flags) {
      snapshot[name] = flag.enabled;
    }
    return snapshot;
  }

  private evaluateConditions(conditions: Record<string, any>, context: Record<string, any>): boolean {
    for (const [key, expectedValue] of Object.entries(conditions)) {
      const contextValue = context[key];
      
      if (Array.isArray(expectedValue)) {
        if (!expectedValue.includes(contextValue)) {
          return false;
        }
      } else if (contextValue !== expectedValue) {
        return false;
      }
    }
    return true;
  }

  private async loadFromDatabase(): Promise<void> {
    // In production, load from database
    // const dbFlags = await db.feature_flags.findAll();
    // dbFlags.forEach(flag => this.flags.set(flag.flag_name, flag));
    this.initialized = true;
  }
}

export const featureFlags = new FeatureFlagService();
export default FeatureFlagService;

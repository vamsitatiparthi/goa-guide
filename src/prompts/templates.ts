// LLM Prompt Templates for GoaGuide Platform

export const PROMPT_TEMPLATES = {
  // Itinerary Generation Prompts
  ITINERARY_MINIMAL_INPUT: `
You are a travel expert specializing in Goa, India. A user has provided minimal input for their trip.

User Input: "{message}"
Destination: {destination}
Context: {context}

Generate follow-up questions to create an optimal itinerary. Focus on:
1. Travel dates and duration
2. Budget per person (in INR)
3. Party composition (adults, children, infants)
4. Travel style (adventure, relaxed, cultural, beach, nightlife)
5. Specific interests or must-see places
6. Dietary restrictions or accessibility needs

Return response as JSON:
{
  "questions": [
    {
      "question_id": "dates",
      "question": "When are you planning to visit Goa?",
      "type": "date_range",
      "required": true
    }
  ],
  "suggested_duration": "2-3 days",
  "estimated_budget_range": "3000-8000 INR per person"
}
`,

  ITINERARY_GENERATION: `
Create a detailed itinerary for Goa based on the following requirements:

Trip Details:
- Destination: {destination}
- Dates: {start_date} to {end_date}
- Party: {adults} adults, {children} children, {infants} infants
- Budget: ₹{budget_per_person} per person
- Preferences: {preferences}
- Constraints: {constraints}

Requirements:
1. Stay within budget (hard constraint)
2. Include family-friendly activities if children present
3. Balance different activity types (beach, cultural, adventure, food)
4. Consider travel time between locations
5. Account for weather and seasonal factors
6. Include local experiences and hidden gems

Return detailed JSON itinerary with:
- Daily schedules with timing
- Activity descriptions and costs
- Travel routes and estimated times
- Alternative options if budget exceeded
- Local tips and recommendations

Format as valid JSON matching the OpenAPI schema.
`,

  // Event Normalization Prompts
  EVENT_NORMALIZATION: `
Normalize the following unstructured event data into a standardized format:

Raw Event Data: {raw_event_data}
Source: {source}

Extract and structure:
1. Event title (clean, concise)
2. Description (2-3 sentences max)
3. Category (festival, market, party, cultural, sports, food)
4. Start and end dates/times
5. Location (extract coordinates if mentioned)
6. Price information
7. Target audience/age restrictions
8. Contact information

Handle duplicates by checking against existing events:
{existing_events}

Return JSON:
{
  "normalized_event": {
    "title": "Clean event title",
    "description": "Brief description",
    "category": "festival",
    "start_date": "2024-12-15T18:00:00+05:30",
    "end_date": "2024-12-15T23:00:00+05:30",
    "location": {
      "address": "Extracted address",
      "lat": 15.2993,
      "lng": 74.1240
    },
    "price_range": {"min": 500, "max": 2000, "currency": "INR"},
    "confidence_score": 0.85,
    "duplicate_of": null
  }
}
`,

  // Provider RFP Generation
  RFP_GENERATION: `
Generate an anonymized Request for Proposal (RFP) for travel providers based on trip requirements:

Trip Profile:
- Party size: {party_size}
- Age groups: {age_groups}
- Trip type: {trip_type}
- Budget per person: ₹{budget_per_person}
- Preferences: {preferences}
- Dates: {dates}

Privacy Requirements:
- NO personal information (names, emails, phones)
- Only anonymized demographic data
- Age brackets instead of specific ages
- General location preferences only

Generate RFP including:
1. Anonymized traveler profile
2. Activity requirements with categories
3. Budget constraints
4. Timeline and response deadline
5. Evaluation criteria

Return structured JSON for provider distribution.
`,

  // Offer Summary and Comparison
  OFFER_SUMMARY: `
Summarize and compare provider offers for the user:

Original Request: {original_request}
Received Offers: {offers}

Create a user-friendly comparison highlighting:
1. Best value for money options
2. Premium experience options  
3. Unique/special offerings
4. Pros and cons of each offer
5. Recommendations based on user preferences

Format as engaging, easy-to-understand summary with clear recommendations.
Consider budget constraints and party composition in recommendations.
`,

  // Blog Content Processing
  BLOG_SUMMARIZATION: `
Summarize this travel blog content for Goa travel insights:

Blog Content: {blog_content}
Source URL: {source_url}

Extract:
1. Key travel tips and recommendations
2. Hidden gems or lesser-known places
3. Seasonal information and best times to visit
4. Budget insights and cost breakdowns
5. Local cultural insights
6. Practical information (transport, accommodation)

Generate:
- 3-sentence summary
- Key takeaways (bullet points)
- Confidence score for information accuracy
- Moderation tags if needed (outdated, promotional, etc.)

Return structured JSON with extracted insights.
`,

  // Error Analysis and PR Generation
  ERROR_TO_PR_PATCH: `
Analyze this error log and suggest a code fix:

Error Details:
- Service: {service_name}
- Error: {error_message}
- Stack Trace: {stack_trace}
- Context: {error_context}
- Frequency: {error_frequency}

Code Context: {relevant_code}

Generate:
1. Root cause analysis
2. Proposed fix with code changes
3. Test cases to prevent regression
4. Risk assessment of the fix
5. Alternative solutions if applicable

Return as structured response with:
- Problem summary
- Proposed solution
- Code diff/patch
- Testing recommendations
- Deployment considerations

Note: This requires developer review before implementation.
`,

  // Content Moderation
  CONTENT_MODERATION: `
Review this user-generated content for appropriateness:

Content: {content}
Content Type: {content_type}
User Context: {user_context}

Check for:
1. Inappropriate language or content
2. Spam or promotional content
3. Misinformation about travel/locations
4. Privacy violations (personal information)
5. Copyright violations

Return moderation decision:
{
  "approved": true/false,
  "confidence": 0.95,
  "issues": ["spam", "inappropriate_language"],
  "suggested_action": "approve|review|reject",
  "explanation": "Brief explanation of decision"
}
`,

  // Conversational Follow-ups
  CONVERSATION_FOLLOWUP: `
Continue this conversation naturally based on user response:

Conversation History: {conversation_history}
Latest User Message: {user_message}
Current Trip Status: {trip_status}

Respond as a helpful travel assistant:
1. Acknowledge user input
2. Ask relevant follow-up questions if needed
3. Provide helpful suggestions
4. Move conversation toward itinerary completion
5. Maintain friendly, professional tone

Keep responses concise and actionable.
Focus on gathering missing information for itinerary optimization.
`,

  // Price and Budget Analysis
  BUDGET_OPTIMIZATION: `
Analyze and optimize this itinerary for budget constraints:

Current Itinerary: {current_itinerary}
Budget Limit: ₹{budget_limit}
Current Cost: ₹{current_cost}
Over Budget By: ₹{over_budget_amount}

Suggest optimizations:
1. Alternative activities with similar experience but lower cost
2. Time-based pricing opportunities
3. Group discounts or package deals
4. Free/low-cost alternatives
5. Priority ranking of activities

Return optimized itinerary maintaining experience quality while meeting budget.
Include explanation of changes and cost savings achieved.
`,

  // Weather and Seasonal Adjustments
  WEATHER_ADAPTATION: `
Adjust itinerary based on weather conditions:

Current Itinerary: {itinerary}
Weather Forecast: {weather_forecast}
Season: {season}
Dates: {dates}

Considerations:
1. Monsoon season impacts (June-September)
2. Peak tourist season (December-February)
3. Hot season adjustments (March-May)
4. Weather-dependent activity alternatives
5. Indoor backup options

Provide weather-optimized itinerary with:
- Activity timing adjustments
- Alternative indoor options
- Seasonal recommendations
- Weather-appropriate clothing/gear suggestions
`,

  // Local Cultural Context
  CULTURAL_INSIGHTS: `
Provide cultural context and etiquette guidance for Goa:

User Profile: {user_profile}
Planned Activities: {activities}
Cultural Background: {user_background}

Include:
1. Local customs and etiquette
2. Religious site guidelines
3. Appropriate dress codes
4. Tipping practices
5. Local language basics (Konkani/Portuguese phrases)
6. Cultural sensitivity tips
7. Festival/celebration information if applicable

Format as helpful, respectful cultural guide.
Avoid stereotypes, focus on practical, respectful travel advice.
`
};

// Prompt utility functions
export class PromptBuilder {
  static buildPrompt(template: string, variables: Record<string, any>): string {
    let prompt = template;
    
    for (const [key, value] of Object.entries(variables)) {
      const placeholder = `{${key}}`;
      const replacement = typeof value === 'object' ? JSON.stringify(value) : String(value);
      prompt = prompt.replace(new RegExp(placeholder, 'g'), replacement);
    }
    
    return prompt.trim();
  }

  static validatePrompt(prompt: string): boolean {
    // Check for unreplaced placeholders
    const placeholderPattern = /\{[^}]+\}/g;
    const unreplacedPlaceholders = prompt.match(placeholderPattern);
    
    if (unreplacedPlaceholders) {
      console.warn('Unreplaced placeholders found:', unreplacedPlaceholders);
      return false;
    }
    
    // Check prompt length
    if (prompt.length > 8000) {
      console.warn('Prompt exceeds recommended length:', prompt.length);
      return false;
    }
    
    return true;
  }

  static sanitizeInput(input: string): string {
    // Remove potential prompt injection attempts
    return input
      .replace(/\b(ignore|forget|disregard)\s+(previous|above|all)\s+(instructions|prompts?)/gi, '[FILTERED]')
      .replace(/\b(system|admin|root)\s+(prompt|instruction)/gi, '[FILTERED]')
      .replace(/\n{3,}/g, '\n\n') // Limit excessive newlines
      .substring(0, 2000); // Limit input length
  }
}

// Prompt routing configuration
export const PROMPT_ROUTING = {
  'itinerary.create': {
    template: 'ITINERARY_MINIMAL_INPUT',
    provider: 'rocket',
    max_tokens: 1000,
    temperature: 0.7,
    cache_ttl: 3600 // 1 hour
  },
  'itinerary.generate': {
    template: 'ITINERARY_GENERATION',
    provider: 'chatgpt',
    max_tokens: 2000,
    temperature: 0.6,
    cache_ttl: 1800 // 30 minutes
  },
  'event.normalize': {
    template: 'EVENT_NORMALIZATION',
    provider: 'local',
    max_tokens: 800,
    temperature: 0.3,
    cache_ttl: 7200 // 2 hours
  },
  'rfp.generate': {
    template: 'RFP_GENERATION',
    provider: 'rocket',
    max_tokens: 1200,
    temperature: 0.5,
    cache_ttl: 3600
  },
  'offer.summarize': {
    template: 'OFFER_SUMMARY',
    provider: 'claude',
    max_tokens: 1500,
    temperature: 0.4,
    cache_ttl: 1800
  },
  'blog.summarize': {
    template: 'BLOG_SUMMARIZATION',
    provider: 'claude',
    max_tokens: 1000,
    temperature: 0.3,
    cache_ttl: 14400 // 4 hours
  },
  'error.analyze': {
    template: 'ERROR_TO_PR_PATCH',
    provider: 'chatgpt',
    max_tokens: 2000,
    temperature: 0.2,
    cache_ttl: 0 // No caching for error analysis
  },
  'content.moderate': {
    template: 'CONTENT_MODERATION',
    provider: 'local',
    max_tokens: 500,
    temperature: 0.1,
    cache_ttl: 3600
  }
};

export default PROMPT_TEMPLATES;

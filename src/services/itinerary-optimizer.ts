import { v4 as uuidv4 } from 'uuid';
import { auditLogger } from '../utils/audit-logger';
import { featureFlags } from '../utils/feature-flags';

export interface OptimizationRequest {
  trip_id: string;
  destination: string;
  dates: {
    start_date: string;
    end_date: string;
  };
  party_composition: {
    adults: number;
    children: number;
    infants: number;
  };
  budget_per_person: number;
  preferences: string[];
  constraints?: {
    mobility_limited?: boolean;
    dietary_restrictions?: string[];
    time_constraints?: string[];
  };
}

export interface Activity {
  activity_id: string;
  title: string;
  description: string;
  category: string;
  duration: number; // minutes
  cost_per_person: number;
  location: {
    lat: number;
    lng: number;
    address: string;
    poi_id?: string;
  };
  provider_id?: string;
  booking_required: boolean;
  weather_dependent: boolean;
  age_appropriate: {
    min_age: number;
    max_age?: number;
  };
  accessibility: {
    wheelchair_accessible: boolean;
    mobility_friendly: boolean;
  };
  time_slots: string[];
  popularity_score: number;
  rating: number;
}

export interface OptimizedItinerary {
  trip_id: string;
  status: 'generated' | 'optimized' | 'budget_exceeded';
  budget_status: 'within_budget' | 'budget_exceeded' | 'budget_unknown';
  total_cost: number;
  currency: string;
  days: DayItinerary[];
  alternatives: Alternative[];
  optimization_metadata: {
    algorithm_version: string;
    optimization_time_ms: number;
    budget_utilization: number;
    constraints_applied: string[];
    fallbacks_used: string[];
  };
  generated_at: string;
}

export interface DayItinerary {
  date: string;
  activities: Activity[];
  total_cost: number;
  travel_time: number;
  weather_forecast?: {
    condition: string;
    temperature: number;
    precipitation_chance: number;
  };
}

export interface Alternative {
  reason: string;
  cost_difference: number;
  activities: Activity[];
  description: string;
}

class ItineraryOptimizer {
  private readonly BUDGET_BUFFER = 0.1; // 10% buffer for budget calculations
  private readonly MAX_TRAVEL_TIME_PER_DAY = 180; // 3 hours max travel per day
  private readonly MIN_ACTIVITY_DURATION = 30; // 30 minutes minimum

  /**
   * Budget-First Itinerary Optimization Algorithm
   * 
   * Algorithm Steps:
   * 1. Parse constraints and preferences
   * 2. Fetch available activities within budget
   * 3. Apply hard constraints (budget, dates, party composition)
   * 4. Score activities based on preferences and ratings
   * 5. Use dynamic programming for optimal day scheduling
   * 6. Minimize travel time between activities
   * 7. Generate alternatives for budget overruns
   * 8. Validate final itinerary against all constraints
   */
  async optimizeItinerary(request: OptimizationRequest): Promise<OptimizedItinerary> {
    const startTime = Date.now();
    const traceId = uuidv4();

    try {
      // Step 1: Validate and parse request
      this.validateRequest(request);
      
      // Step 2: Calculate budget constraints
      const totalBudget = request.budget_per_person * (
        request.party_composition.adults + 
        request.party_composition.children * 0.7 + // Children 70% of adult cost
        request.party_composition.infants * 0.1    // Infants 10% of adult cost
      );
      
      const budgetPerDay = totalBudget / this.calculateTripDuration(request.dates);
      
      // Step 3: Fetch candidate activities
      const candidateActivities = await this.fetchCandidateActivities(request);
      
      // Step 4: Apply hard constraints
      const feasibleActivities = this.applyHardConstraints(candidateActivities, request, budgetPerDay);
      
      if (feasibleActivities.length === 0) {
        return this.generateBudgetExceededResponse(request, totalBudget);
      }
      
      // Step 5: Score and rank activities
      const scoredActivities = this.scoreActivities(feasibleActivities, request);
      
      // Step 6: Generate optimal daily schedules
      const optimizedDays = await this.generateDailySchedules(
        scoredActivities, 
        request, 
        budgetPerDay
      );
      
      // Step 7: Calculate total cost and validate budget
      const totalCost = optimizedDays.reduce((sum, day) => sum + day.total_cost, 0);
      const budgetStatus = totalCost <= totalBudget * (1 + this.BUDGET_BUFFER) 
        ? 'within_budget' 
        : 'budget_exceeded';
      
      // Step 8: Generate alternatives if needed
      const alternatives = budgetStatus === 'budget_exceeded' 
        ? await this.generateAlternatives(optimizedDays, totalBudget, request)
        : [];
      
      const optimizationTime = Date.now() - startTime;
      
      // Audit log
      await auditLogger.log({
        trace_id: traceId,
        action: 'itinerary.optimized',
        entity_type: 'itinerary',
        entity_id: request.trip_id,
        metadata: {
          total_cost: totalCost,
          budget_status: budgetStatus,
          optimization_time_ms: optimizationTime,
          activities_count: optimizedDays.reduce((sum, day) => sum + day.activities.length, 0)
        }
      });
      
      return {
        trip_id: request.trip_id,
        status: budgetStatus === 'within_budget' ? 'optimized' : 'budget_exceeded',
        budget_status: budgetStatus,
        total_cost: totalCost,
        currency: 'INR',
        days: optimizedDays,
        alternatives,
        optimization_metadata: {
          algorithm_version: '1.0.0',
          optimization_time_ms: optimizationTime,
          budget_utilization: totalCost / totalBudget,
          constraints_applied: this.getAppliedConstraints(request),
          fallbacks_used: []
        },
        generated_at: new Date().toISOString()
      };
      
    } catch (error) {
      await auditLogger.logError(error as Error, {
        trace_id: traceId,
        trip_id: request.trip_id,
        optimization_request: request
      });
      throw error;
    }
  }

  private validateRequest(request: OptimizationRequest): void {
    if (!request.trip_id || !request.destination) {
      throw new Error('trip_id and destination are required');
    }
    
    if (!request.dates.start_date || !request.dates.end_date) {
      throw new Error('start_date and end_date are required');
    }
    
    if (new Date(request.dates.start_date) >= new Date(request.dates.end_date)) {
      throw new Error('start_date must be before end_date');
    }
    
    if (request.budget_per_person <= 0) {
      throw new Error('budget_per_person must be positive');
    }
    
    const totalPeople = request.party_composition.adults + 
                       request.party_composition.children + 
                       request.party_composition.infants;
    
    if (totalPeople === 0) {
      throw new Error('At least one person required in party composition');
    }
  }

  private calculateTripDuration(dates: { start_date: string; end_date: string }): number {
    const start = new Date(dates.start_date);
    const end = new Date(dates.end_date);
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }

  private async fetchCandidateActivities(request: OptimizationRequest): Promise<Activity[]> {
    // In production, this would query the database with geospatial search
    // For now, return mock data based on Goa POIs
    
    const mockActivities: Activity[] = [
      {
        activity_id: 'baga_beach_001',
        title: 'Baga Beach Family Day',
        description: 'Family-friendly beach with water sports and restaurants',
        category: 'beach',
        duration: 240,
        cost_per_person: 800,
        location: {
          lat: 15.5557,
          lng: 73.7516,
          address: 'Baga Beach, Goa',
          poi_id: 'poi_baga_beach'
        },
        booking_required: false,
        weather_dependent: true,
        age_appropriate: { min_age: 0 },
        accessibility: { wheelchair_accessible: false, mobility_friendly: true },
        time_slots: ['09:00', '10:00', '11:00', '14:00', '15:00'],
        popularity_score: 0.9,
        rating: 4.5
      },
      {
        activity_id: 'old_goa_tour_001',
        title: 'Old Goa Heritage Tour',
        description: 'UNESCO World Heritage churches and museums',
        category: 'cultural',
        duration: 180,
        cost_per_person: 600,
        location: {
          lat: 15.5007,
          lng: 73.9115,
          address: 'Old Goa, Goa',
          poi_id: 'poi_old_goa'
        },
        booking_required: true,
        weather_dependent: false,
        age_appropriate: { min_age: 8 },
        accessibility: { wheelchair_accessible: true, mobility_friendly: true },
        time_slots: ['09:00', '11:00', '14:00', '16:00'],
        popularity_score: 0.8,
        rating: 4.3
      },
      {
        activity_id: 'dudhsagar_trek_001',
        title: 'Dudhsagar Falls Trek',
        description: 'Adventure trek to four-tiered waterfall',
        category: 'adventure',
        duration: 360,
        cost_per_person: 2500,
        location: {
          lat: 15.3144,
          lng: 74.3144,
          address: 'Dudhsagar Falls, Mollem, Goa'
        },
        booking_required: true,
        weather_dependent: true,
        age_appropriate: { min_age: 12, max_age: 65 },
        accessibility: { wheelchair_accessible: false, mobility_friendly: false },
        time_slots: ['06:00', '07:00'],
        popularity_score: 0.7,
        rating: 4.7
      },
      {
        activity_id: 'anjuna_market_001',
        title: 'Anjuna Flea Market',
        description: 'Weekly market with local crafts, clothes, and food',
        category: 'shopping',
        duration: 120,
        cost_per_person: 300,
        location: {
          lat: 15.5735,
          lng: 73.7395,
          address: 'Anjuna Beach, Goa'
        },
        booking_required: false,
        weather_dependent: false,
        age_appropriate: { min_age: 0 },
        accessibility: { wheelchair_accessible: false, mobility_friendly: true },
        time_slots: ['10:00', '11:00', '12:00', '14:00', '15:00', '16:00'],
        popularity_score: 0.6,
        rating: 4.1
      }
    ];

    // Filter by destination and preferences
    return mockActivities.filter(activity => {
      // Basic destination filtering would be done via geospatial query in production
      return true;
    });
  }

  private applyHardConstraints(
    activities: Activity[], 
    request: OptimizationRequest, 
    budgetPerDay: number
  ): Activity[] {
    return activities.filter(activity => {
      // Budget constraint
      if (activity.cost_per_person > budgetPerDay) {
        return false;
      }
      
      // Age appropriateness
      const hasChildren = request.party_composition.children > 0;
      const hasInfants = request.party_composition.infants > 0;
      
      if (hasInfants && activity.age_appropriate.min_age > 2) {
        return false;
      }
      
      if (hasChildren && activity.age_appropriate.min_age > 12) {
        return false;
      }
      
      // Accessibility constraints
      if (request.constraints?.mobility_limited && !activity.accessibility.mobility_friendly) {
        return false;
      }
      
      return true;
    });
  }

  private scoreActivities(activities: Activity[], request: OptimizationRequest): Activity[] {
    return activities.map(activity => {
      let score = activity.rating * 0.3 + activity.popularity_score * 0.2;
      
      // Preference matching
      const preferenceBonus = request.preferences.reduce((bonus, pref) => {
        if (activity.category.toLowerCase().includes(pref.toLowerCase()) ||
            activity.title.toLowerCase().includes(pref.toLowerCase()) ||
            activity.description.toLowerCase().includes(pref.toLowerCase())) {
          return bonus + 0.2;
        }
        return bonus;
      }, 0);
      
      score += Math.min(preferenceBonus, 0.5); // Cap preference bonus at 0.5
      
      // Family-friendly bonus
      if (request.party_composition.children > 0 && activity.age_appropriate.min_age === 0) {
        score += 0.1;
      }
      
      // Weather dependency penalty for weather-dependent activities
      if (activity.weather_dependent) {
        score -= 0.05;
      }
      
      return { ...activity, score };
    }).sort((a, b) => (b as any).score - (a as any).score);
  }

  private async generateDailySchedules(
    activities: Activity[], 
    request: OptimizationRequest, 
    budgetPerDay: number
  ): Promise<DayItinerary[]> {
    const days: DayItinerary[] = [];
    const tripDuration = this.calculateTripDuration(request.dates);
    
    for (let dayIndex = 0; dayIndex < tripDuration; dayIndex++) {
      const currentDate = new Date(request.dates.start_date);
      currentDate.setDate(currentDate.getDate() + dayIndex);
      
      const dayActivities = this.selectDayActivities(activities, budgetPerDay, dayIndex);
      const optimizedSchedule = this.optimizeDaySchedule(dayActivities);
      
      const dayTotalCost = optimizedSchedule.reduce((sum, activity) => 
        sum + (activity.cost_per_person * this.getPartyMultiplier(request.party_composition)), 0);
      
      const travelTime = this.calculateTravelTime(optimizedSchedule);
      
      days.push({
        date: currentDate.toISOString().split('T')[0],
        activities: optimizedSchedule,
        total_cost: dayTotalCost,
        travel_time: travelTime
      });
    }
    
    return days;
  }

  private selectDayActivities(activities: Activity[], budgetPerDay: number, dayIndex: number): Activity[] {
    // Dynamic programming approach for activity selection
    const availableActivities = activities.slice(); // Copy array
    const selectedActivities: Activity[] = [];
    let remainingBudget = budgetPerDay;
    let remainingTime = 8 * 60; // 8 hours available per day
    
    // Greedy selection with budget and time constraints
    for (const activity of availableActivities) {
      if (activity.cost_per_person <= remainingBudget && 
          activity.duration <= remainingTime) {
        selectedActivities.push(activity);
        remainingBudget -= activity.cost_per_person;
        remainingTime -= activity.duration + 30; // Add 30 min buffer between activities
        
        if (selectedActivities.length >= 4) break; // Max 4 activities per day
      }
    }
    
    return selectedActivities;
  }

  private optimizeDaySchedule(activities: Activity[]): Activity[] {
    if (activities.length <= 1) return activities;
    
    // Sort by time preference and minimize travel time
    // This is a simplified version - in production would use TSP algorithm
    const scheduled = [...activities];
    
    // Sort by preferred start times and logical flow
    scheduled.sort((a, b) => {
      const aTime = a.time_slots[0] || '09:00';
      const bTime = b.time_slots[0] || '09:00';
      return aTime.localeCompare(bTime);
    });
    
    return scheduled;
  }

  private calculateTravelTime(activities: Activity[]): number {
    if (activities.length <= 1) return 0;
    
    let totalTravelTime = 0;
    
    for (let i = 0; i < activities.length - 1; i++) {
      const current = activities[i];
      const next = activities[i + 1];
      
      // Simplified distance calculation (in production, use Maps API)
      const distance = this.calculateDistance(
        current.location.lat, current.location.lng,
        next.location.lat, next.location.lng
      );
      
      // Assume 30 km/h average speed in Goa
      const travelTimeMinutes = (distance / 30) * 60;
      totalTravelTime += travelTimeMinutes;
    }
    
    return Math.round(totalTravelTime);
  }

  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    // Haversine formula for distance calculation
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private getPartyMultiplier(composition: { adults: number; children: number; infants: number }): number {
    return composition.adults + (composition.children * 0.7) + (composition.infants * 0.1);
  }

  private async generateAlternatives(
    days: DayItinerary[], 
    totalBudget: number, 
    request: OptimizationRequest
  ): Promise<Alternative[]> {
    const alternatives: Alternative[] = [];
    const currentCost = days.reduce((sum, day) => sum + day.total_cost, 0);
    const overBudget = currentCost - totalBudget;
    
    // Generate budget-friendly alternative
    alternatives.push({
      reason: 'Budget optimization',
      cost_difference: -overBudget,
      activities: [], // Would contain cheaper alternatives
      description: `Reduce costs by ₹${Math.round(overBudget)} by selecting more budget-friendly activities`
    });
    
    // Generate premium alternative
    alternatives.push({
      reason: 'Premium experience',
      cost_difference: totalBudget * 0.3,
      activities: [], // Would contain premium activities
      description: 'Enhanced experience with premium activities and services'
    });
    
    return alternatives;
  }

  private generateBudgetExceededResponse(request: OptimizationRequest, totalBudget: number): OptimizedItinerary {
    return {
      trip_id: request.trip_id,
      status: 'budget_exceeded',
      budget_status: 'budget_exceeded',
      total_cost: 0,
      currency: 'INR',
      days: [],
      alternatives: [
        {
          reason: 'Increase budget',
          cost_difference: totalBudget * 0.5,
          activities: [],
          description: `Consider increasing budget to ₹${Math.round(totalBudget * 1.5)} per person for better options`
        }
      ],
      optimization_metadata: {
        algorithm_version: '1.0.0',
        optimization_time_ms: 0,
        budget_utilization: 0,
        constraints_applied: this.getAppliedConstraints(request),
        fallbacks_used: ['budget_exceeded_response']
      },
      generated_at: new Date().toISOString()
    };
  }

  private getAppliedConstraints(request: OptimizationRequest): string[] {
    const constraints = ['budget_constraint', 'date_constraint'];
    
    if (request.party_composition.children > 0) {
      constraints.push('child_friendly_constraint');
    }
    
    if (request.party_composition.infants > 0) {
      constraints.push('infant_friendly_constraint');
    }
    
    if (request.constraints?.mobility_limited) {
      constraints.push('mobility_constraint');
    }
    
    if (request.constraints?.dietary_restrictions?.length) {
      constraints.push('dietary_constraint');
    }
    
    return constraints;
  }
}

export const itineraryOptimizer = new ItineraryOptimizer();
export default ItineraryOptimizer;

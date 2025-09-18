import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { auditLogger } from '../utils/audit-logger';
import { llmOrchestrator } from './llm-orchestrator';
import { featureFlags } from '../utils/feature-flags';

export interface CreateTripRequest {
  destination: string;
  message: string;
  dates?: {
    start_date: string;
    end_date: string;
  };
  party_composition?: {
    adults: number;
    children: number;
    infants: number;
  };
  budget_per_person?: number;
  preferences?: string[];
}

export interface Trip {
  trip_id: string;
  status: 'created' | 'questions_pending' | 'generating' | 'ready' | 'booked';
  destination: string;
  follow_up_questions?: FollowUpQuestion[];
  created_at: string;
  updated_at: string;
}

export interface FollowUpQuestion {
  question_id: string;
  question: string;
  type: 'single_choice' | 'multiple_choice' | 'text' | 'number' | 'date';
  options?: string[];
  required: boolean;
}

export class TripService {
  async createTrip(req: Request, res: Response): Promise<void> {
    const traceId = req.headers['x-trace-id'] as string || uuidv4();
    
    try {
      const { destination, message, dates, party_composition, budget_per_person, preferences }: CreateTripRequest = req.body;
      
      // Validate required fields
      if (!destination || !message) {
        res.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: 'destination and message are required',
            trace_id: traceId
          }
        });
        return;
      }

      const tripId = uuidv4();
      
      // Generate follow-up questions using LLM
      const followUpQuestions = await this.generateFollowUpQuestions(message, {
        destination,
        dates,
        party_composition,
        budget_per_person,
        preferences
      });

      const trip: Trip = {
        trip_id: tripId,
        status: followUpQuestions.length > 0 ? 'questions_pending' : 'generating',
        destination,
        follow_up_questions: followUpQuestions,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Store in database (stub)
      // await db.trips.create(trip);

      // Audit log
      await auditLogger.log({
        trace_id: traceId,
        action: 'trip.created',
        entity_type: 'trip',
        entity_id: tripId,
        user_id: req.user?.id
      });

      res.status(201).json(trip);
    } catch (error) {
      res.status(500).json({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to create trip',
          trace_id: traceId
        }
      });
    }
  }

  async getTrip(req: Request, res: Response): Promise<void> {
    const { tripId } = req.params;
    const traceId = req.headers['x-trace-id'] as string || uuidv4();

    try {
      // Database query stub
      // const trip = await db.trips.findById(tripId);
      
      const mockTrip: Trip = {
        trip_id: tripId,
        status: 'ready',
        destination: 'Goa',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      res.json(mockTrip);
    } catch (error) {
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Trip with ID '${tripId}' not found`,
          trace_id: traceId
        }
      });
    }
  }

  private async generateFollowUpQuestions(message: string, context: any): Promise<FollowUpQuestion[]> {
    if (!await featureFlags.isEnabled('llm_orchestration')) {
      return [];
    }

    const prompt = `Based on the travel request: "${message}" and context: ${JSON.stringify(context)}, 
    generate 2-3 follow-up questions to optimize the itinerary. Return as JSON array.`;

    try {
      const response = await llmOrchestrator.generate({
        prompt,
        provider: 'rocket',
        max_tokens: 500
      });

      return response.questions || [];
    } catch (error) {
      console.error('Failed to generate follow-up questions:', error);
      return [];
    }
  }
}

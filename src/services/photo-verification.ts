import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as ExifReader from 'exifreader';
import sharp from 'sharp';
import { auditLogger } from '../utils/audit-logger';
import { featureFlags } from '../utils/feature-flags';
import { llmOrchestrator } from './llm-orchestrator';

export interface PhotoVerificationRequest {
  trip_id: string;
  activity_id: string;
  photo_buffer: Buffer;
  claimed_location?: {
    lat: number;
    lng: number;
  };
  claimed_timestamp?: string;
}

export interface PhotoVerificationResult {
  photo_id: string;
  status: 'verified' | 'rejected' | 'manual_review' | 'processing';
  verification_score: number;
  issues: string[];
  exif_data: {
    gps_coordinates?: { lat: number; lng: number };
    timestamp?: string;
    camera_info?: string;
    device_info?: string;
  };
  vision_analysis?: {
    location_match: boolean;
    authenticity_score: number;
    detected_objects: string[];
    spoof_indicators: string[];
  };
  verified_at?: string;
}

export interface DeviceAttestation {
  device_id: string;
  platform: 'ios' | 'android' | 'web';
  attestation_token?: string;
  sensor_data?: {
    accelerometer: number[];
    gyroscope: number[];
    magnetometer: number[];
    timestamp: string;
  };
}

class PhotoVerificationService {
  private readonly VERIFICATION_THRESHOLDS = {
    PASS: 0.85,
    MANUAL_REVIEW: 0.6,
    REJECT: 0.6
  };

  private readonly MAX_LOCATION_DISTANCE_KM = 1.0; // 1km tolerance
  private readonly MAX_TIME_DIFFERENCE_HOURS = 2; // 2 hour tolerance

  async verifyPhoto(request: PhotoVerificationRequest, deviceAttestation?: DeviceAttestation): Promise<PhotoVerificationResult> {
    const photoId = uuidv4();
    const traceId = uuidv4();

    try {
      // Check if photo verification is enabled
      if (!await featureFlags.isEnabled('photo_verification')) {
        throw new Error('Photo verification is disabled');
      }

      // Initialize verification result
      const result: PhotoVerificationResult = {
        photo_id: photoId,
        status: 'processing',
        verification_score: 0,
        issues: [],
        exif_data: {}
      };

      // Step 1: Extract and validate EXIF data
      const exifValidation = await this.validateExifData(request.photo_buffer, request);
      result.exif_data = exifValidation.exif_data;
      result.issues.push(...exifValidation.issues);

      // Step 2: Perform vision analysis
      if (await featureFlags.isEnabled('vision_model_enabled')) {
        const visionAnalysis = await this.performVisionAnalysis(request.photo_buffer, request);
        result.vision_analysis = visionAnalysis;
        result.issues.push(...visionAnalysis.spoof_indicators);
      }

      // Step 3: Device attestation validation
      if (deviceAttestation) {
        const attestationResult = await this.validateDeviceAttestation(deviceAttestation, request);
        if (!attestationResult.valid) {
          result.issues.push('device_attestation_failed');
        }
      }

      // Step 4: Calculate overall verification score
      result.verification_score = this.calculateVerificationScore(result, exifValidation);

      // Step 5: Determine final status
      result.status = this.determineVerificationStatus(result.verification_score, result.issues);

      if (result.status === 'verified') {
        result.verified_at = new Date().toISOString();
      }

      // Audit log
      await auditLogger.log({
        trace_id: traceId,
        action: 'photo.verified',
        entity_type: 'photo',
        entity_id: photoId,
        metadata: {
          trip_id: request.trip_id,
          activity_id: request.activity_id,
          verification_score: result.verification_score,
          status: result.status,
          issues_count: result.issues.length
        }
      });

      return result;

    } catch (error) {
      await auditLogger.logError(error as Error, {
        trace_id: traceId,
        photo_id: photoId,
        trip_id: request.trip_id
      });

      return {
        photo_id: photoId,
        status: 'rejected',
        verification_score: 0,
        issues: ['processing_error'],
        exif_data: {}
      };
    }
  }

  private async validateExifData(photoBuffer: Buffer, request: PhotoVerificationRequest): Promise<{
    exif_data: any;
    issues: string[];
    location_valid: boolean;
    timestamp_valid: boolean;
  }> {
    const issues: string[] = [];
    let locationValid = false;
    let timestampValid = false;

    try {
      // Extract EXIF data
      const tags = ExifReader.load(photoBuffer);
      
      const exifData = {
        gps_coordinates: this.extractGPSCoordinates(tags),
        timestamp: this.extractTimestamp(tags),
        camera_info: this.extractCameraInfo(tags),
        device_info: this.extractDeviceInfo(tags)
      };

      // Validate GPS coordinates
      if (exifData.gps_coordinates && request.claimed_location) {
        const distance = this.calculateDistance(
          exifData.gps_coordinates.lat,
          exifData.gps_coordinates.lng,
          request.claimed_location.lat,
          request.claimed_location.lng
        );

        if (distance <= this.MAX_LOCATION_DISTANCE_KM) {
          locationValid = true;
        } else {
          issues.push(`location_mismatch_${Math.round(distance * 1000)}m`);
        }
      } else if (!exifData.gps_coordinates) {
        issues.push('missing_gps_data');
      }

      // Validate timestamp
      if (exifData.timestamp && request.claimed_timestamp) {
        const exifTime = new Date(exifData.timestamp);
        const claimedTime = new Date(request.claimed_timestamp);
        const timeDifferenceHours = Math.abs(exifTime.getTime() - claimedTime.getTime()) / (1000 * 60 * 60);

        if (timeDifferenceHours <= this.MAX_TIME_DIFFERENCE_HOURS) {
          timestampValid = true;
        } else {
          issues.push(`timestamp_mismatch_${Math.round(timeDifferenceHours)}h`);
        }
      } else if (!exifData.timestamp) {
        issues.push('missing_timestamp');
      }

      // Check for EXIF manipulation indicators
      if (this.detectExifManipulation(tags)) {
        issues.push('exif_manipulation_detected');
      }

      return {
        exif_data: exifData,
        issues,
        location_valid: locationValid,
        timestamp_valid: timestampValid
      };

    } catch (error) {
      issues.push('exif_extraction_failed');
      return {
        exif_data: {},
        issues,
        location_valid: false,
        timestamp_valid: false
      };
    }
  }

  private async performVisionAnalysis(photoBuffer: Buffer, request: PhotoVerificationRequest): Promise<{
    location_match: boolean;
    authenticity_score: number;
    detected_objects: string[];
    spoof_indicators: string[];
  }> {
    try {
      // Resize image for analysis
      const resizedBuffer = await sharp(photoBuffer)
        .resize(800, 600, { fit: 'inside' })
        .jpeg({ quality: 85 })
        .toBuffer();

      // Convert to base64 for LLM analysis
      const base64Image = resizedBuffer.toString('base64');

      // Use LLM for image analysis (in production, use specialized vision models)
      const analysisPrompt = `
        Analyze this photo for authenticity and location verification:
        
        Expected location: Goa, India
        Activity context: ${request.activity_id}
        
        Check for:
        1. Signs of digital manipulation or editing
        2. Consistency with Goa landscape/architecture
        3. Objects and landmarks visible
        4. Lighting and shadow consistency
        5. Image quality indicators
        
        Return JSON analysis:
        {
          "authenticity_score": 0.85,
          "location_indicators": ["palm_trees", "beach", "portuguese_architecture"],
          "spoof_indicators": ["inconsistent_shadows", "digital_artifacts"],
          "confidence": 0.9
        }
      `;

      const visionResponse = await llmOrchestrator.generate({
        prompt: analysisPrompt,
        provider: 'claude',
        max_tokens: 800,
        temperature: 0.2
      });

      try {
        const analysis = JSON.parse(visionResponse.content);
        
        return {
          location_match: analysis.location_indicators?.length > 0,
          authenticity_score: analysis.authenticity_score || 0.5,
          detected_objects: analysis.location_indicators || [],
          spoof_indicators: analysis.spoof_indicators || []
        };
      } catch (parseError) {
        return {
          location_match: false,
          authenticity_score: 0.5,
          detected_objects: [],
          spoof_indicators: ['vision_analysis_failed']
        };
      }

    } catch (error) {
      return {
        location_match: false,
        authenticity_score: 0.3,
        detected_objects: [],
        spoof_indicators: ['vision_processing_error']
      };
    }
  }

  private async validateDeviceAttestation(attestation: DeviceAttestation, request: PhotoVerificationRequest): Promise<{
    valid: boolean;
    confidence: number;
    issues: string[];
  }> {
    const issues: string[] = [];

    try {
      // Validate attestation token (platform-specific)
      if (attestation.platform === 'ios' && attestation.attestation_token) {
        // iOS DeviceCheck validation would go here
        // For now, basic validation
        if (!attestation.attestation_token.startsWith('ios_')) {
          issues.push('invalid_ios_attestation');
        }
      } else if (attestation.platform === 'android' && attestation.attestation_token) {
        // Android SafetyNet validation would go here
        if (!attestation.attestation_token.startsWith('android_')) {
          issues.push('invalid_android_attestation');
        }
      }

      // Validate sensor data consistency
      if (attestation.sensor_data) {
        const sensorConsistency = this.validateSensorData(attestation.sensor_data);
        if (!sensorConsistency.valid) {
          issues.push(...sensorConsistency.issues);
        }
      }

      return {
        valid: issues.length === 0,
        confidence: issues.length === 0 ? 0.9 : 0.3,
        issues
      };

    } catch (error) {
      return {
        valid: false,
        confidence: 0.1,
        issues: ['attestation_validation_failed']
      };
    }
  }

  private calculateVerificationScore(result: PhotoVerificationResult, exifValidation: any): number {
    let score = 0.5; // Base score

    // EXIF data validation (40% weight)
    if (exifValidation.location_valid) score += 0.2;
    if (exifValidation.timestamp_valid) score += 0.2;

    // Vision analysis (40% weight)
    if (result.vision_analysis) {
      score += result.vision_analysis.authenticity_score * 0.4;
    }

    // Penalty for issues (20% weight)
    const issuePenalty = Math.min(result.issues.length * 0.05, 0.2);
    score -= issuePenalty;

    return Math.max(0, Math.min(1, score));
  }

  private determineVerificationStatus(score: number, issues: string[]): 'verified' | 'rejected' | 'manual_review' {
    // Critical issues always require manual review or rejection
    const criticalIssues = ['exif_manipulation_detected', 'device_attestation_failed'];
    const hasCriticalIssues = issues.some(issue => criticalIssues.includes(issue));

    if (hasCriticalIssues) {
      return 'rejected';
    }

    if (score >= this.VERIFICATION_THRESHOLDS.PASS) {
      return 'verified';
    } else if (score >= this.VERIFICATION_THRESHOLDS.MANUAL_REVIEW) {
      return 'manual_review';
    } else {
      return 'rejected';
    }
  }

  // Utility methods
  private extractGPSCoordinates(tags: any): { lat: number; lng: number } | null {
    try {
      const lat = tags['GPS Latitude']?.description;
      const lng = tags['GPS Longitude']?.description;
      const latRef = tags['GPS Latitude Ref']?.description;
      const lngRef = tags['GPS Longitude Ref']?.description;

      if (lat && lng) {
        const latitude = this.convertDMSToDD(lat, latRef);
        const longitude = this.convertDMSToDD(lng, lngRef);
        return { lat: latitude, lng: longitude };
      }
    } catch (error) {
      console.error('GPS extraction error:', error);
    }
    return null;
  }

  private extractTimestamp(tags: any): string | null {
    try {
      const dateTime = tags['DateTime']?.description || tags['DateTime Original']?.description;
      if (dateTime) {
        return new Date(dateTime.replace(/:/g, '-').replace(/ /, 'T')).toISOString();
      }
    } catch (error) {
      console.error('Timestamp extraction error:', error);
    }
    return null;
  }

  private extractCameraInfo(tags: any): string {
    const make = tags['Make']?.description || '';
    const model = tags['Model']?.description || '';
    return `${make} ${model}`.trim();
  }

  private extractDeviceInfo(tags: any): string {
    const software = tags['Software']?.description || '';
    return software;
  }

  private convertDMSToDD(dms: string, ref: string): number {
    // Convert Degrees, Minutes, Seconds to Decimal Degrees
    const parts = dms.split(/[^\d\w\.]+/);
    const degrees = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    
    let dd = degrees + minutes / 60 + seconds / 3600;
    if (ref === 'S' || ref === 'W') dd = dd * -1;
    
    return dd;
  }

  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    // Haversine formula
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  private detectExifManipulation(tags: any): boolean {
    // Simple heuristics for EXIF manipulation detection
    const suspiciousIndicators = [
      !tags['DateTime Original'], // Missing original timestamp
      tags['Software']?.description?.includes('Photoshop'), // Edited with photo editing software
      tags['ColorSpace']?.description !== 'sRGB' // Non-standard color space
    ];

    return suspiciousIndicators.filter(Boolean).length >= 2;
  }

  private validateSensorData(sensorData: any): { valid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check accelerometer data consistency
    if (sensorData.accelerometer) {
      const magnitude = Math.sqrt(
        sensorData.accelerometer[0] ** 2 +
        sensorData.accelerometer[1] ** 2 +
        sensorData.accelerometer[2] ** 2
      );
      
      // Should be close to 9.8 m/s² (gravity) when stationary
      if (magnitude < 8 || magnitude > 12) {
        issues.push('unusual_accelerometer_reading');
      }
    }

    // Check for sensor data timestamp consistency
    const sensorTime = new Date(sensorData.timestamp);
    const now = new Date();
    const timeDiff = Math.abs(now.getTime() - sensorTime.getTime()) / 1000;
    
    if (timeDiff > 300) { // 5 minutes tolerance
      issues.push('sensor_timestamp_mismatch');
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  // REST API endpoint handler
  async handlePhotoUpload(req: Request, res: Response): Promise<void> {
    const traceId = req.headers['x-trace-id'] as string || uuidv4();

    try {
      const { trip_id, activity_id } = req.body;
      const photoFile = req.file;

      if (!photoFile) {
        res.status(400).json({
          error: {
            code: 'MISSING_PHOTO',
            message: 'Photo file is required',
            trace_id: traceId
          }
        });
        return;
      }

      const verificationRequest: PhotoVerificationRequest = {
        trip_id,
        activity_id,
        photo_buffer: photoFile.buffer,
        claimed_location: req.body.location ? JSON.parse(req.body.location) : undefined,
        claimed_timestamp: req.body.timestamp
      };

      const deviceAttestation: DeviceAttestation | undefined = req.body.device_attestation
        ? JSON.parse(req.body.device_attestation)
        : undefined;

      const result = await this.verifyPhoto(verificationRequest, deviceAttestation);

      res.json(result);

    } catch (error) {
      res.status(500).json({
        error: {
          code: 'VERIFICATION_ERROR',
          message: error instanceof Error ? error.message : 'Photo verification failed',
          trace_id: traceId
        }
      });
    }
  }
}

export const photoVerificationService = new PhotoVerificationService();
export default PhotoVerificationService;

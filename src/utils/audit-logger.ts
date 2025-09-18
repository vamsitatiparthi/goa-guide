import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { featureFlags } from './feature-flags';

export interface AuditLogEntry {
  trace_id: string;
  service_name?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  user_id?: string;
  payload_hash?: string;
  feature_flags_snapshot?: Record<string, boolean>;
  consent_snapshot?: Record<string, any>;
  ip_address?: string;
  user_agent?: string;
  metadata?: Record<string, any>;
}

export interface StoredAuditLog extends AuditLogEntry {
  log_id: string;
  created_at: string;
}

class AuditLogger {
  private buffer: StoredAuditLog[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startFlushTimer();
  }

  async log(entry: AuditLogEntry): Promise<void> {
    // Check if audit logging is enabled
    if (!await featureFlags.isEnabled('audit_logging')) {
      return;
    }

    const auditLog: StoredAuditLog = {
      log_id: uuidv4(),
      trace_id: entry.trace_id,
      service_name: entry.service_name || 'goaguide-api',
      action: entry.action,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      user_id: entry.user_id,
      payload_hash: entry.payload_hash,
      feature_flags_snapshot: featureFlags.getSnapshot(),
      consent_snapshot: entry.consent_snapshot,
      ip_address: entry.ip_address,
      user_agent: entry.user_agent,
      created_at: new Date().toISOString(),
      ...entry.metadata
    };

    // Add to buffer for batch processing
    this.buffer.push(auditLog);

    // Immediate flush for critical actions
    const criticalActions = [
      'booking.confirmed',
      'payment.processed',
      'consent.granted',
      'consent.revoked',
      'user.deleted',
      'feature_flag.updated'
    ];

    if (criticalActions.includes(entry.action)) {
      await this.flush();
    }
  }

  async logRequest(req: any, action: string, entityType?: string, entityId?: string): Promise<void> {
    await this.log({
      trace_id: req.headers['x-trace-id'] || uuidv4(),
      action,
      entity_type: entityType,
      entity_id: entityId,
      user_id: req.user?.id,
      ip_address: req.ip || req.connection.remoteAddress,
      user_agent: req.headers['user-agent'],
      payload_hash: this.hashPayload(req.body)
    });
  }

  async logError(error: Error, context: Record<string, any>): Promise<void> {
    await this.log({
      trace_id: context.trace_id || uuidv4(),
      action: 'error.occurred',
      entity_type: 'error',
      entity_id: error.name,
      payload_hash: this.hashPayload({
        message: error.message,
        stack: error.stack,
        context
      }),
      metadata: {
        error_message: error.message,
        error_stack: error.stack?.substring(0, 1000), // Truncate stack trace
        ...context
      }
    });
  }

  async logConsentChange(userId: string, consentType: string, granted: boolean, traceId: string): Promise<void> {
    await this.log({
      trace_id: traceId,
      action: granted ? 'consent.granted' : 'consent.revoked',
      entity_type: 'consent',
      entity_id: consentType,
      user_id: userId,
      consent_snapshot: {
        [consentType]: granted,
        timestamp: new Date().toISOString()
      }
    });
  }

  async logDataAccess(userId: string, dataType: string, purpose: string, traceId: string): Promise<void> {
    await this.log({
      trace_id: traceId,
      action: 'data.accessed',
      entity_type: 'user_data',
      entity_id: dataType,
      user_id: userId,
      metadata: {
        purpose,
        data_type: dataType
      }
    });
  }

  async logDataDeletion(userId: string, dataTypes: string[], reason: string, traceId: string): Promise<void> {
    await this.log({
      trace_id: traceId,
      action: 'data.deleted',
      entity_type: 'user_data',
      entity_id: userId,
      user_id: userId,
      metadata: {
        data_types: dataTypes,
        reason,
        deletion_timestamp: new Date().toISOString()
      }
    });
  }

  async search(filters: {
    user_id?: string;
    action?: string;
    entity_type?: string;
    trace_id?: string;
    start_date?: string;
    end_date?: string;
    limit?: number;
    offset?: number;
  }): Promise<StoredAuditLog[]> {
    // In production, this would query the database
    // For now, return filtered buffer results
    let results = [...this.buffer];

    if (filters.user_id) {
      results = results.filter(log => log.user_id === filters.user_id);
    }
    if (filters.action) {
      results = results.filter(log => log.action.includes(filters.action));
    }
    if (filters.entity_type) {
      results = results.filter(log => log.entity_type === filters.entity_type);
    }
    if (filters.trace_id) {
      results = results.filter(log => log.trace_id === filters.trace_id);
    }
    if (filters.start_date) {
      results = results.filter(log => log.created_at >= filters.start_date!);
    }
    if (filters.end_date) {
      results = results.filter(log => log.created_at <= filters.end_date!);
    }

    const offset = filters.offset || 0;
    const limit = filters.limit || 100;
    
    return results
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(offset, offset + limit);
  }

  async generateComplianceReport(userId: string, startDate: string, endDate: string): Promise<{
    user_id: string;
    report_period: { start: string; end: string };
    data_access_events: StoredAuditLog[];
    consent_changes: StoredAuditLog[];
    data_deletions: StoredAuditLog[];
    summary: {
      total_access_events: number;
      consent_grants: number;
      consent_revocations: number;
      data_deletions: number;
    };
  }> {
    const accessEvents = await this.search({
      user_id: userId,
      action: 'data.accessed',
      start_date: startDate,
      end_date: endDate
    });

    const consentChanges = await this.search({
      user_id: userId,
      action: 'consent.',
      start_date: startDate,
      end_date: endDate
    });

    const dataDeletions = await this.search({
      user_id: userId,
      action: 'data.deleted',
      start_date: startDate,
      end_date: endDate
    });

    const consentGrants = consentChanges.filter(log => log.action === 'consent.granted').length;
    const consentRevocations = consentChanges.filter(log => log.action === 'consent.revoked').length;

    return {
      user_id: userId,
      report_period: { start: startDate, end: endDate },
      data_access_events: accessEvents,
      consent_changes: consentChanges,
      data_deletions: dataDeletions,
      summary: {
        total_access_events: accessEvents.length,
        consent_grants: consentGrants,
        consent_revocations: consentRevocations,
        data_deletions: dataDeletions.length
      }
    };
  }

  private hashPayload(payload: any): string {
    if (!payload) return '';
    
    const serialized = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto.createHash('sha256').update(serialized).digest('hex').substring(0, 16);
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const logsToFlush = [...this.buffer];
    this.buffer = [];

    try {
      // In production, batch insert to database
      // await db.audit_logs.batchInsert(logsToFlush);
      
      // For development, log to console
      if (process.env.NODE_ENV === 'development') {
        console.log(`[AUDIT] Flushed ${logsToFlush.length} audit logs`);
      }
    } catch (error) {
      console.error('Failed to flush audit logs:', error);
      // Re-add failed logs to buffer for retry
      this.buffer.unshift(...logsToFlush);
    }
  }

  private startFlushTimer(): void {
    // Flush buffer every 30 seconds
    this.flushInterval = setInterval(() => {
      this.flush().catch(console.error);
    }, 30000);
  }

  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
  }
}

export const auditLogger = new AuditLogger();

// Graceful shutdown handling
process.on('SIGTERM', () => {
  auditLogger.shutdown().catch(console.error);
});

process.on('SIGINT', () => {
  auditLogger.shutdown().catch(console.error);
});

export default AuditLogger;

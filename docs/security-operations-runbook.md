# GoaGuide Security & Operations Runbook

## Table of Contents
1. [Security Overview](#security-overview)
2. [Feature Flag Management](#feature-flag-management)
3. [Audit & Compliance](#audit--compliance)
4. [Incident Response](#incident-response)
5. [Operational Procedures](#operational-procedures)
6. [Monitoring & Alerting](#monitoring--alerting)
7. [Data Protection](#data-protection)
8. [Penetration Testing](#penetration-testing)

## Security Overview

### Security Architecture
- **OAuth2/OIDC** authentication with Auth0/AWS Cognito
- **MFA required** for all admin users
- **JWT tokens** with 15-minute TTL + refresh rotation
- **API Gateway** with WAF protection
- **mTLS** for internal service communication
- **Secrets management** via AWS Secrets Manager/HashiCorp Vault

### Security Hardening Checklist
- [ ] All services use HTTPS/TLS 1.3
- [ ] API Gateway configured with rate limiting
- [ ] WAF rules active (OWASP Top 10 protection)
- [ ] Database connections encrypted
- [ ] Secrets rotated regularly (90 days)
- [ ] Container images scanned for vulnerabilities
- [ ] Network segmentation implemented
- [ ] Backup encryption verified

## Feature Flag Management

### Core Feature Flags
```typescript
const CORE_FLAGS = {
  'events_ingest': true,        // Event data ingestion
  'provider_rfp': true,         // Provider RFP system
  'auto_book': false,           // Automatic booking
  'adventure_validator': true,   // Adventure validation
  'photo_verification': true,    // Photo authenticity
  'llm_orchestration': true,     // LLM services
  'audit_logging': true,         // Audit trail
  'api_gateway': true           // Gateway features
};
```

### Flag Management Procedures

#### Enabling a Feature Flag
1. **Pre-deployment checks:**
   ```bash
   # Verify feature is ready
   npm run test:feature -- --flag=new_feature
   
   # Check dependencies
   npm run check:dependencies -- --flag=new_feature
   
   # Validate configuration
   npm run validate:config -- --flag=new_feature
   ```

2. **Gradual rollout:**
   ```bash
   # Enable for 5% of users
   curl -X PUT /admin/api/v1/flags/new_feature \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"enabled": true, "conditions": {"user_percentage": 5}}'
   
   # Monitor metrics for 24 hours
   # Increase to 25% if stable
   # Full rollout after validation
   ```

3. **Audit trail:**
   - All flag changes logged with user ID and timestamp
   - Approval required for production changes
   - Rollback plan documented

#### Emergency Flag Disable
```bash
# Immediate disable (use in emergencies)
curl -X PUT /admin/api/v1/flags/problematic_feature \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"enabled": false, "reason": "emergency_disable"}'

# Verify disable
curl -X GET /admin/api/v1/flags/problematic_feature
```

### Flag Lifecycle Management
1. **Development:** Flag created, default disabled
2. **Testing:** Enabled in staging environment
3. **Canary:** Enabled for 5% production traffic
4. **Rollout:** Gradual increase to 100%
5. **Cleanup:** Remove flag code after 30 days stable

## Audit & Compliance

### Audit Log Requirements
All audit logs must include:
- `trace_id` - Request correlation ID
- `service_version` - Service version number
- `feature_flags_snapshot` - Active flags at time of action
- `consent_snapshot` - User consent status
- `payload_hash` - SHA256 hash of sensitive data

### Critical Events to Audit
- User authentication/authorization
- Booking creation/modification/cancellation
- Payment processing
- Consent granted/revoked
- Data access (PII)
- Feature flag changes
- Admin actions
- Security incidents

### Compliance Reporting
```bash
# Generate GDPR compliance report
curl -X POST /admin/api/v1/audit/compliance-report \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{
    "user_id": "user_123",
    "start_date": "2024-01-01",
    "end_date": "2024-12-31",
    "report_type": "gdpr"
  }'

# Generate audit trail for specific incident
curl -X GET "/admin/api/v1/audit/search?trace_id=incident_456&limit=1000"
```

### Data Retention Policy
- **Hot storage:** 90 days (fast access)
- **Cold storage:** 3+ years (compliance)
- **Audit logs:** 7+ years (immutable)
- **User data:** Configurable with right-to-erase

## Incident Response

### Security Incident Classification
- **P0 (Critical):** Data breach, system compromise, payment fraud
- **P1 (High):** Authentication bypass, privilege escalation
- **P2 (Medium):** DoS attacks, data exposure
- **P3 (Low):** Suspicious activity, policy violations

### Incident Response Playbook

#### P0 - Critical Security Incident
1. **Immediate Response (0-15 minutes):**
   ```bash
   # Isolate affected systems
   kubectl scale deployment suspicious-service --replicas=0
   
   # Enable emergency mode
   curl -X PUT /admin/api/v1/flags/emergency_mode \
     -d '{"enabled": true}'
   
   # Alert security team
   curl -X POST $PAGERDUTY_WEBHOOK \
     -d '{"incident_key": "security_p0", "description": "Critical security incident"}'
   ```

2. **Assessment (15-60 minutes):**
   - Determine scope of compromise
   - Identify affected users/data
   - Document timeline of events
   - Preserve evidence for forensics

3. **Containment (1-4 hours):**
   - Block malicious IPs at WAF level
   - Rotate compromised credentials
   - Patch vulnerabilities
   - Implement additional monitoring

4. **Recovery (4-24 hours):**
   - Restore services from clean backups
   - Verify system integrity
   - Gradual service restoration
   - User notification if required

#### Data Breach Response
1. **Immediate actions:**
   ```bash
   # Stop data processing
   kubectl patch deployment data-processor -p '{"spec":{"replicas":0}}'
   
   # Secure evidence
   kubectl logs data-processor > breach-evidence-$(date +%Y%m%d-%H%M%S).log
   
   # Notify legal team
   echo "Data breach detected at $(date)" | mail -s "URGENT: Data Breach" legal@company.com
   ```

2. **Assessment within 72 hours:**
   - Determine personal data affected
   - Assess risk to individuals
   - Document breach details
   - Prepare regulatory notifications

### Communication Templates

#### Internal Security Alert
```
SECURITY ALERT - P0 INCIDENT

Incident ID: SEC-2024-001
Detected: 2024-12-15 14:30 UTC
Status: ACTIVE
Affected Systems: Payment processing, User authentication

Initial Assessment:
- Potential unauthorized access to user payment data
- Approximately 1,000 users potentially affected
- Attack vector: SQL injection in booking endpoint

Immediate Actions Taken:
- Booking service isolated
- Payment processing suspended
- Security team mobilized
- Forensic analysis initiated

Next Update: 16:00 UTC
Incident Commander: security@goaguide.com
```

## Operational Procedures

### Daily Operations Checklist
- [ ] Review security alerts and logs
- [ ] Check system health dashboards
- [ ] Verify backup completion
- [ ] Monitor feature flag metrics
- [ ] Review audit log anomalies
- [ ] Check certificate expiration dates
- [ ] Validate security scanning results

### Weekly Security Tasks
- [ ] Review access logs for anomalies
- [ ] Update threat intelligence feeds
- [ ] Patch non-critical vulnerabilities
- [ ] Review and rotate API keys
- [ ] Conduct security awareness training
- [ ] Test incident response procedures
- [ ] Review and update security policies

### Monthly Security Review
- [ ] Comprehensive vulnerability assessment
- [ ] Access control audit
- [ ] Security metrics review
- [ ] Compliance status check
- [ ] Penetration testing results review
- [ ] Security training effectiveness assessment
- [ ] Incident response plan updates

### Deployment Security Checklist
```bash
# Pre-deployment security checks
npm run security:scan
npm run dependency:audit
npm run secrets:validate
npm run compliance:check

# Post-deployment verification
curl -X GET /health/security
curl -X GET /metrics/security
kubectl get pods --selector=security-scan=passed
```

## Monitoring & Alerting

### Security Metrics Dashboard
- Authentication failure rates
- API request anomalies
- Failed authorization attempts
- Suspicious user behavior patterns
- Feature flag usage statistics
- Audit log volume and patterns

### Critical Alerts
```yaml
# Prometheus alerting rules
groups:
  - name: security
    rules:
      - alert: HighAuthFailureRate
        expr: rate(auth_failures_total[5m]) > 10
        labels:
          severity: critical
        annotations:
          summary: "High authentication failure rate detected"
      
      - alert: UnauthorizedDataAccess
        expr: increase(unauthorized_access_total[1m]) > 0
        labels:
          severity: critical
        annotations:
          summary: "Unauthorized data access attempt"
      
      - alert: AuditLogGap
        expr: absent_over_time(audit_logs_total[10m])
        labels:
          severity: warning
        annotations:
          summary: "Audit logging appears to have stopped"
```

### Log Analysis Queries
```bash
# Detect brute force attacks
grep "authentication_failed" /var/log/goaguide/audit.log | \
  awk '{print $4}' | sort | uniq -c | sort -nr | head -10

# Find privilege escalation attempts
jq '.action | select(contains("admin") or contains("privilege"))' \
  /var/log/goaguide/audit.log

# Monitor feature flag changes
jq 'select(.action == "feature_flag.updated")' \
  /var/log/goaguide/audit.log | tail -20
```

## Data Protection

### Privacy-First Architecture
- **Anonymized RFPs:** Only age_bracket, gender, party_size shared with providers
- **Explicit consent:** PII sharing requires consent tokens
- **Data minimization:** Collect only necessary information
- **Purpose limitation:** Data used only for stated purposes

### PII Handling Procedures
```typescript
// Example: Anonymize user data for provider RFP
function anonymizeUserProfile(user: User): AnonymizedProfile {
  return {
    age_bracket: getAgeBracket(user.age),
    gender: user.gender || 'not_specified',
    party_size: user.party_composition.total,
    trip_type: classifyTripType(user.preferences),
    budget_per_person: user.budget_per_person,
    preferences: user.preferences.filter(p => !isPII(p))
  };
}
```

### Right to Erasure Implementation
```bash
# User data deletion request
curl -X DELETE /admin/api/v1/users/user_123/data \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"reason": "user_request", "confirmation": "confirmed"}'

# Verify deletion
curl -X GET /admin/api/v1/users/user_123/deletion-status
```

### Consent Management
- Granular consent for different data uses
- Consent withdrawal mechanisms
- Audit trail for all consent changes
- Regular consent refresh requirements

## Penetration Testing

### Pre-Production Testing Requirements
- **OWASP Top 10** vulnerability assessment
- **API security testing** (injection, broken auth, etc.)
- **Infrastructure penetration testing**
- **Social engineering assessment**
- **Mobile app security testing**

### Testing Schedule
- **Quarterly:** Automated vulnerability scans
- **Bi-annually:** Professional penetration testing
- **Annually:** Comprehensive security audit
- **Ad-hoc:** After major feature releases

### Bug Bounty Program
```yaml
# Bug bounty scope and rewards
scope:
  - api.goaguide.com/*
  - app.goaguide.com/*
  - admin.goaguide.com/*

rewards:
  critical: $5000-$10000    # RCE, SQL injection, auth bypass
  high: $1000-$5000         # XSS, CSRF, privilege escalation  
  medium: $500-$1000        # Information disclosure, DoS
  low: $100-$500            # Security misconfigurations

exclusions:
  - Social engineering
  - Physical attacks
  - DoS attacks
  - Spam/phishing
```

### Remediation SLAs
- **Critical:** 24 hours
- **High:** 72 hours  
- **Medium:** 7 days
- **Low:** 30 days

## Emergency Contacts

### Security Team
- **Security Lead:** security-lead@goaguide.com
- **Incident Commander:** incident-commander@goaguide.com
- **On-call Engineer:** +1-555-SECURITY

### External Contacts
- **Legal Counsel:** legal@goaguide.com
- **Compliance Officer:** compliance@goaguide.com
- **PR/Communications:** pr@goaguide.com
- **Cyber Insurance:** insurance-provider@company.com

### Regulatory Bodies
- **Data Protection Authority:** dpa@gov.in
- **CERT-In:** incident@cert-in.org.in
- **Local Law Enforcement:** cyber-crime@police.gov.in

## Appendices

### A. Security Configuration Templates
### B. Incident Response Forms
### C. Compliance Checklists
### D. Security Training Materials
### E. Vendor Security Requirements

---

**Document Version:** 1.0  
**Last Updated:** 2024-12-15  
**Next Review:** 2025-03-15  
**Owner:** Security Team  
**Approved By:** CTO, Legal Counsel

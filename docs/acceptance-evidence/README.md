# Acceptance Evidence Contract

This directory holds independently reviewable evidence for SRS acceptance criteria. Unit tests, source-string checks, copied logic, and mock-only tests remain useful regression coverage but cannot by themselves authorize a production-ready claim.

When all remediation gates have passed, create `release-evidence.json` with this shape:

```json
{
  "schemaVersion": 1,
  "status": "production-approved",
  "commit": "40-character-git-commit",
  "environment": "reviewable environment identifier",
  "generatedAt": "ISO-8601 timestamp",
  "criteria": [
    {
      "id": "AC-1",
      "status": "passed",
      "evidence": [
        {
          "kind": "integration",
          "path": "docs/acceptance-evidence/ac-1-context-retrieval.json"
        }
      ]
    }
  ]
}
```

The final manifest must contain AC-1 through AC-10. Every linked path must exist. Evidence kinds `mock`, `source-inspection`, and `unit` are rejected as production sign-off evidence by the CI guard.

Protocol contract-test doubles are useful for hermetic remediation tests, but must be explicitly labelled in their artifacts. Evidence that identifies a contract-test double cannot support a `production-approved` release claim; attach a separate smoke-test artifact from the configured cloud provider first.

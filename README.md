# Active Directory Update User Attributes Action

Update user attributes in on-premise Active Directory via LDAP/LDAPS.

## Overview

This action modifies user attributes in Active Directory using the LDAP `replace` operation via the `ldapts` library. The `replace` operation is inherently idempotent -- setting the same attribute to the same value multiple times produces no errors and no side effects.

Supports updating any combination of standard AD user attributes in a single call. Scalar values are automatically wrapped in arrays as required by the LDAP protocol.

## Prerequisites

- Network access to an Active Directory Domain Controller (LDAP port 389 or LDAPS port 636)
- A service account with **Write** permissions on the target user objects
- The Distinguished Name (DN) of the user to update

## Configuration

### Authentication

| Secret | Description |
|--------|-------------|
| `BASIC_USERNAME` | Bind DN of the service account (e.g., `CN=svc-sgnl,OU=Service Accounts,DC=example,DC=com`) |
| `BASIC_PASSWORD` | Password for the service account |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ADDRESS` | LDAP/LDAPS URL of the Domain Controller (e.g., `ldaps://dc.example.com:636`) | Required |
| `TLS_SKIP_VERIFY` | Set to `true` to skip TLS certificate verification | `false` |

### Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userDN` | text | Yes | Distinguished Name of the user to update |
| `attributes` | object | No | Key-value pairs of LDAP attributes to set |
| `samAccountName` | text | No | SAM account name (maps to `sAMAccountName`) |
| `firstName` | text | No | First name (maps to `givenName`) |
| `lastName` | text | No | Last name (maps to `sn`) |
| `displayName` | text | No | Display name (maps to `displayName`) |
| `email` | text | No | Email address (maps to `mail`) |
| `company` | text | No | Company name (maps to `company`) |
| `department` | text | No | Department name (maps to `department`) |
| `title` | text | No | Job title (maps to `title`) |
| `address` | text | No | LDAP URL override (takes precedence over `ADDRESS` env var) |

At least one attribute must be provided, either via named parameters, the `attributes` object, or both. Named parameters take precedence over conflicting keys in `attributes`.

### Output

| Field | Type | Description |
|-------|------|-------------|
| `status` | text | `success` or `halted` |
| `userDN` | text | DN of the updated user |
| `modified` | boolean | `true` if attributes were updated |
| `attributes` | array | List of attribute names that were modified |
| `address` | text | LDAP server address used |

## Usage Examples

### Basic Usage

```json
{
  "userDN": "CN=John Doe,OU=Users,DC=example,DC=com",
  "attributes": {
    "displayName": "John Doe",
    "mail": "john.doe@example.com",
    "department": "Engineering"
  }
}
```

### Using Named Parameters

```json
{
  "userDN": "CN=John Doe,OU=Users,DC=example,DC=com",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "department": "Engineering",
  "title": "Software Engineer"
}
```

Named parameters can be combined with the `attributes` object for less common LDAP attributes:

```json
{
  "userDN": "CN=John Doe,OU=Users,DC=example,DC=com",
  "firstName": "John",
  "email": "john.doe@example.com",
  "attributes": {
    "physicalDeliveryOfficeName": "Building A, Room 101",
    "telephoneNumber": "+1-555-0100"
  }
}
```

### Full Job Specification

```json
{
  "id": "update-user-attrs",
  "type": "nodejs-20",
  "script": {
    "repository": "github.com/sgnl-actions/ad-update-user",
    "version": "v1.0.0",
    "type": "nodejs"
  },
  "script_inputs": {
    "userDN": "CN=John Doe,OU=Users,DC=example,DC=com",
    "attributes": {
      "displayName": "John Doe",
      "department": "Engineering",
      "title": "Software Engineer"
    }
  },
  "environment": {
    "ADDRESS": "ldaps://dc.example.com:636",
    "TLS_SKIP_VERIFY": "false"
  }
}
```

### Skip TLS Verification

For development or self-signed certificate environments:

```json
{
  "environment": {
    "ADDRESS": "ldaps://dc.dev.example.com:636",
    "TLS_SKIP_VERIFY": "true"
  }
}
```

## API Details

### LDAP Modify/Replace Operation

This action uses the LDAP `replace` modification type for each attribute. The `replace` operation:

- Sets the attribute to the specified value(s) if it exists
- Creates the attribute with the specified value(s) if it does not exist
- Is idempotent -- calling with the same values produces no errors

### Named Parameter Mapping

| Named Parameter | LDAP Attribute |
|-----------------|---------------|
| `samAccountName` | `sAMAccountName` |
| `firstName` | `givenName` |
| `lastName` | `sn` |
| `displayName` | `displayName` |
| `email` | `mail` |
| `company` | `company` |
| `department` | `department` |
| `title` | `title` |

### Common AD Attributes

| Attribute | Description | Example |
|-----------|-------------|---------|
| `displayName` | Display name | `John Doe` |
| `mail` | Email address | `john@example.com` |
| `department` | Department | `Engineering` |
| `title` | Job title | `Software Engineer` |
| `telephoneNumber` | Phone number | `+1-555-0100` |
| `physicalDeliveryOfficeName` | Office location | `Building A, Room 101` |
| `manager` | Manager DN | `CN=Jane Smith,OU=Users,DC=example,DC=com` |
| `description` | Description | `Senior engineer on platform team` |
| `company` | Company name | `Example Corp` |
| `streetAddress` | Street address | `123 Main St` |
| `l` | City | `San Francisco` |
| `st` | State | `CA` |
| `postalCode` | Postal/ZIP code | `94105` |

Multi-valued attributes (e.g., `otherTelephone`, `proxyAddresses`) can be passed as arrays:

```json
{
  "attributes": {
    "otherTelephone": ["+1-555-0100", "+1-555-0101"]
  }
}
```

## Error Handling

### Success Scenarios

- **Attribute updated** -- returns `status: "success"`, `modified: true`
- **Same value re-applied** -- returns `status: "success"`, `modified: true` (idempotent, no error)

### Retryable Errors

| Error | Description |
|-------|-------------|
| Network timeout | Domain Controller unreachable |
| Connection refused | LDAP service not running |
| Server busy | DC under heavy load |

### Fatal Errors

| LDAP Code | Error | Description |
|-----------|-------|-------------|
| 32 | No Such Object | The `userDN` does not exist in AD |
| 19 | Constraint Violation | Attribute value violates AD schema constraints |
| 17 | Undefined Attribute Type | Attribute name not recognized by the AD schema |
| 49 | Invalid Credentials | Bind DN or password is incorrect |
| 50 | Insufficient Access Rights | Service account lacks Write permission |

## Security Considerations

- Use LDAPS (port 636) in production to encrypt credentials and data in transit
- Only skip TLS verification (`TLS_SKIP_VERIFY=true`) in development environments
- The service account should have minimal permissions -- only Write access on the specific user attributes needed
- Attribute values are not logged; only attribute names appear in the output to avoid leaking sensitive data

## Development

```bash
# Install dependencies
npm install

# Run unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Build distribution bundle
npm run build

# Validate metadata
npm run validate

# Lint code
npm run lint
npm run lint:fix

# Run locally with mock data
npm run dev
```

## Troubleshooting

### Connection Issues

- Verify the Domain Controller is reachable: `telnet dc.example.com 636`
- Check that the `ADDRESS` environment variable includes the protocol and port: `ldaps://dc.example.com:636`
- For LDAPS, ensure the DC's certificate is trusted or set `TLS_SKIP_VERIFY=true` for testing

### Authentication Failures

- Verify the bind DN format matches your AD structure
- Ensure the service account password has not expired
- Check that the service account is not locked out

### Permission Errors

- The service account needs Write permission on the target user object's attributes
- Use AD delegation to grant granular permissions rather than Domain Admin

### Attribute Errors

- Verify attribute names match the AD schema (LDAP names, not display names)
- Check that attribute values conform to the schema's syntax rules (e.g., email format for `mail`)
- For multi-valued attributes, pass an array of values

## Support

- [SGNL Documentation](https://docs.sgnl.ai)
- [GitHub Issues](https://github.com/sgnl-actions/ad-update-user/issues)

# Active Directory Create User Action

Create a new user in on-premise Active Directory via LDAP/LDAPS.

## Overview

This action creates a new user object in Active Directory using the LDAP `add` operation via the `ldapts` library. It automatically sets the required AD object classes (`top`, `person`, `organizationalPerson`, `user`), extracts the `cn` from the provided DN, and configures the account state via `userAccountControl`. The action supports comprehensive error handling through the enhanced SGNL testing framework.

Key capabilities:
- **Flexible attribute mapping**: Set standard AD attributes via friendly parameter names or arbitrary attributes via `additionalAttributes`
- **Password management**: Set initial password (requires LDAPS) and optionally force password change at next login
- **Account state control**: Create accounts as enabled (`userAccountControl: 512`) or disabled (`514`)
- **Idempotent operations**: Optional `successIfAlreadyExists` flag treats duplicate creation as success
- **Dry run mode**: Validate parameters without making changes to Active Directory
- **Comprehensive testing**: Scenario-based testing framework with full ldapts mocking and 8 test scenarios

## Prerequisites

- Network access to an Active Directory Domain Controller (LDAP port 389 or LDAPS port 636)
- A service account with permission to **create user objects** in the target OU
- LDAPS is required if setting the initial password (`unicodePwd` attribute)

## Configuration

### Authentication

| Secret | Description |
|--------|-------------|
| `LDAP_BIND_DN` | Bind DN of the service account (e.g., `CN=svc-sgnl,OU=Service Accounts,DC=example,DC=com`) |
| `LDAP_BIND_PASSWORD` | Password for the service account |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ADDRESS` | LDAP/LDAPS URL of the Domain Controller (e.g., `ldaps://dc.example.com:636`) | Required |
| `TLS_SKIP_VERIFY` | Set to `true` to skip TLS certificate verification | `false` |

### Input Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `userDN` | text | Yes | Distinguished Name for the new user (must start with `CN=`) | `CN=John Doe,OU=Users,DC=corp,DC=example,DC=com` |
| `samAccountName` | text | Yes | SAM account name (maps to `sAMAccountName`) | `jdoe` |
| `userPrincipalName` | text | Yes | User Principal Name (maps to `userPrincipalName`) | `jdoe@example.com` |
| `firstName` | text | Yes | First name (maps to `givenName`) | `John` |
| `lastName` | text | Yes | Last name (maps to `sn`) | `Doe` |
| `displayName` | text | No | Display name (maps to `displayName`) | `John Doe` |
| `email` | text | No | Email address (maps to `mail`) | `john.doe@example.com` |
| `company` | text | No | Company name (maps to `company`) | `Example Corp` |
| `department` | text | No | Department name (maps to `department`) | `Engineering` |
| `title` | text | No | Job title (maps to `title`) | `Software Engineer` |
| `enabled` | boolean | No | Whether the account is enabled (default: `false`) | `true` |
| `password` | text | No | Initial password (encoded as `unicodePwd`; requires LDAPS) | `P@ssw0rd!` |
| `changePasswordAtNextLogin` | boolean | No | Whether the user must change their password at next login (default: `false`; sets `pwdLastSet` to `0`) | `true` |
| `additionalAttributes` | object | No | Key-value pairs of additional LDAP attributes to set | `{"telephoneNumber": "+1-555-0100", "physicalDeliveryOfficeName": "Building A"}` |
| `successIfAlreadyExists` | boolean | No | If `true`, return success when user already exists instead of throwing an error (default: `false`) | `true` |
| `address` | text | No | Optional LDAP server URL override | `ldaps://ad.corp.example.com:636` |

### Output

| Field | Type | Description |
|-------|------|-------------|
| `status` | text | `success` or `halted` |
| `userDN` | text | DN of the created user |
| `created` | boolean | `true` if the user was created, `false` if it already existed |
| `alreadyExisted` | boolean | `true` if the user already existed (when `successIfAlreadyExists` is enabled) |
| `attributes` | array | List of user-supplied attribute names that were set |
| `address` | text | LDAP server address used |

## Usage Examples

### Basic Usage

```json
{
  "userDN": "CN=John Doe,OU=Users,DC=example,DC=com",
  "samAccountName": "jdoe",
  "userPrincipalName": "jdoe@example.com",
  "firstName": "John",
  "lastName": "Doe"
}
```

This creates a disabled user with the minimum required attributes. The `objectClass`, `cn`, and `userAccountControl` are set automatically.

### Using Named Parameters

```json
{
  "userDN": "CN=John Doe,OU=Users,DC=example,DC=com",
  "samAccountName": "jdoe",
  "userPrincipalName": "jdoe@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "department": "Engineering",
  "title": "Software Engineer"
}
```

### With Password and Disabled Account

```json
{
  "userDN": "CN=John Doe,OU=Users,DC=example,DC=com",
  "samAccountName": "jdoe",
  "userPrincipalName": "jdoe@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "password": "P@ssw0rd!",
  "enabled": false
}
```

### Idempotent Creation (Success If Already Exists)

Use `successIfAlreadyExists: true` for idempotent operations where you want the action to succeed even if the user already exists:

```json
{
  "userDN": "CN=John Doe,OU=Users,DC=example,DC=com",
  "samAccountName": "jdoe",
  "userPrincipalName": "jdoe@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "successIfAlreadyExists": true
}
```

When the user already exists and this flag is set, the response will include:
- `status: "success"`
- `created: false`
- `alreadyExisted: true`

### Mixed Named Parameters and Additional Attributes

Named parameters can be combined with the `additionalAttributes` object for less common LDAP attributes:

```json
{
  "userDN": "CN=John Doe,OU=Users,DC=example,DC=com",
  "samAccountName": "jdoe",
  "userPrincipalName": "jdoe@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "email": "john.doe@example.com",
  "additionalAttributes": {
    "physicalDeliveryOfficeName": "Building A, Room 101",
    "telephoneNumber": "+1-555-0100"
  }
}
```

### Full Job Specification

```json
{
  "id": "create-ad-user",
  "type": "nodejs-20",
  "script": {
    "repository": "github.com/sgnl-actions/ad-create-user",
    "version": "v1.0.0",
    "type": "nodejs"
  },
  "script_inputs": {
    "userDN": "CN=John Doe,OU=Users,DC=example,DC=com",
    "samAccountName": "jdoe",
    "userPrincipalName": "jdoe@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "department": "Engineering",
    "title": "Software Engineer",
    "enabled": true
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

### LDAP Add Operation

This action uses the LDAP `add` operation to create a new directory entry. The entry is built as follows:

1. **objectClass** — automatically set to `['top', 'person', 'organizationalPerson', 'user']`
2. **cn** — extracted from the `userDN` (e.g., `CN=John Doe,...` → `cn: "John Doe"`)
3. **User-supplied attributes** — from named parameters and the `additionalAttributes` object
4. **userAccountControl** — `514` (disabled) by default, `512` if `enabled: true`
5. **unicodePwd** — only included when `password` is provided; the password is wrapped in double quotes and encoded as UTF-16LE per AD requirements
6. **pwdLastSet** — set to `0` when `changePasswordAtNextLogin` is `true`, forcing a password change at next login

### Named Parameter Mapping

| Named Parameter | LDAP Attribute |
|-----------------|---------------|
| `samAccountName` | `sAMAccountName` |
| `userPrincipalName` | `userPrincipalName` |
| `firstName` | `givenName` |
| `lastName` | `sn` |
| `displayName` | `displayName` |
| `email` | `mail` |
| `company` | `company` |
| `department` | `department` |
| `title` | `title` |

## Error Handling

### Success Scenarios

- **User created** — returns `status: "success"`, `created: true`, `alreadyExisted: false`
- **User already exists (with `successIfAlreadyExists: true`)** — returns `status: "success"`, `created: false`, `alreadyExisted: true`

### Retryable Errors

| Error | Description |
|-------|-------------|
| Network timeout | Domain Controller unreachable |
| Connection refused | LDAP service not running |
| Server busy | DC under heavy load |

### Fatal Errors

| LDAP Code | Error | Description |
|-----------|-------|-------------|
| 68 | Entry Already Exists | A user with the same DN already exists in AD (use `successIfAlreadyExists: true` to treat as success) |
| 19 | Constraint Violation | Attribute value violates AD schema constraints |
| 17 | Undefined Attribute Type | Attribute name not recognized by the AD schema |
| 53 | Unwilling to Perform | Typically: setting `unicodePwd` over non-SSL connection |
| 49 | Invalid Credentials | Bind DN or password is incorrect |
| 50 | Insufficient Access Rights | Service account lacks permission to create users |

## Security Considerations

- Use LDAPS (port 636) in production to encrypt credentials and data in transit
- LDAPS is **required** for setting the initial password (`unicodePwd`)
- Only skip TLS verification (`TLS_SKIP_VERIFY=true`) in development environments
- The service account should have minimal permissions — only the ability to create user objects in the target OU
- Attribute values are not logged; only attribute names appear in the output to avoid leaking sensitive data

## Development

### Setup

```bash
npm install
```

### Run tests

This action uses the enhanced SGNL testing framework with comprehensive LDAP mocking support. All 8 test scenarios validate user creation, idempotency, error handling, and dry run behavior:

```bash
npm test
```

The test suite includes:
- Successful user creation with attribute mapping
- Idempotent creation with `successIfAlreadyExists` flag
- Already-exists error when flag is not set
- Authentication and permission failure handling
- Dry run validation
- Missing required parameter validation

### Run tests in watch mode

```bash
npm run test:watch
```

### Build

```bash
npm run build
```

### Validate metadata

```bash
npm run validate
```

### Lint

```bash
npm run lint
npm run lint:fix
```

### Local testing

Copy the sample environment file and configure with your AD credentials:

```bash
cp .env.sample .env
```

Then edit `.env` with your actual values:

```
AD_ADDRESS=ldap://your-dc.example.com:389
LDAP_BIND_DN=CN=admin,DC=example,DC=com
LDAP_BIND_PASSWORD=your-password
TLS_SKIP_VERIFY=false

# Test parameters - customize as needed
USER_DN=CN=John Smith,OU=Users,DC=corp,DC=example,DC=com
SAM_ACCOUNT_NAME=jsmith
ENABLED=false
SUCCESS_IF_ALREADY_EXISTS=true
DRY_RUN=false
```

Then run:

```bash
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

- The service account needs permission to create user objects in the target OU
- Use AD delegation to grant the "Create User objects" permission on the target OU

### Entry Already Exists (LDAP Code 68)

- A user with the same DN already exists — use a different DN or delete the existing user first

### Password Errors (LDAP Code 53)

- Setting `unicodePwd` requires an LDAPS connection — ensure the `ADDRESS` uses `ldaps://`
- The password must meet the domain's password complexity requirements

### Attribute Errors

- Verify attribute names match the AD schema (LDAP names, not display names)
- Check that attribute values conform to the schema's syntax rules (e.g., email format for `mail`)
- For multi-valued attributes, pass an array of values

## Support

- [ldapts Documentation](https://github.com/ldapts/ldapts) - LDAP client library used for Active Directory operations
- [SGNL Testing Framework](https://github.com/sgnl-actions/testing) - Enhanced testing with LDAP mocking capabilities
- [Active Directory LDAP Reference](https://docs.microsoft.com/en-us/windows/win32/ad/active-directory-domain-services)
- [SGNL Actions Documentation](https://github.com/sgnl-actions)

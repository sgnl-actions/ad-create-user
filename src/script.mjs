/**
 * Active Directory Create User Action
 *
 * Creates a new user in on-premise Active Directory using LDAP/LDAPS.
 * Supports setting password, enabling/disabling account, and custom attributes.
 */

import { Client } from 'ldapts';
import { getBaseURL } from '@sgnl-actions/utils';

/** Required object classes for AD users */
const AD_USER_OBJECT_CLASS = ['top', 'person', 'organizationalPerson', 'user'];

/** userAccountControl values for enabled/disabled accounts */
const UAC_ENABLED = '512';   // NORMAL_ACCOUNT
const UAC_DISABLED = '514';  // NORMAL_ACCOUNT | ACCOUNTDISABLE

/**
 * Mapping from friendly parameter names to LDAP attribute names.
 * These are the commonly used AD user attributes.
 */
const PARAM_TO_LDAP = {
  samAccountName: 'sAMAccountName',
  userPrincipalName: 'userPrincipalName',
  firstName: 'givenName',
  lastName: 'sn',
  displayName: 'displayName',
  email: 'mail',
  company: 'company',
  department: 'department',
  title: 'title'
};

/**
 * Extract the Common Name (CN) from a Distinguished Name.
 *
 * @param {string} dn - The Distinguished Name (e.g., "CN=John Doe,OU=Users,DC=example,DC=com")
 * @returns {string} The CN value
 * @throws {Error} If DN doesn't start with CN=
 */
function extractCN(dn) {
  const match = dn.match(/^CN=((?:[^\\,]|\\.)+)/i);
  if (!match) {
    throw new Error('userDN must start with CN= (e.g., CN=John Doe,OU=Users,DC=example,DC=com)');
  }
  // Unescape DN escape sequences to get the raw CN value
  return match[1].replace(/\\(.)/g, '$1');
}

/**
 * Encode a password for Active Directory using UTF-16LE format.
 * AD requires passwords to be wrapped in quotes and encoded as UTF-16LE.
 *
 * @param {string} password - The plaintext password
 * @returns {Buffer} The encoded password buffer
 */
function encodePassword(password) {
  const quoted = `"${password}"`;
  return Buffer.from(quoted, 'utf16le');
}

/**
 * Build LDAP attributes object from params, mapping friendly names to LDAP names.
 * Named params override conflicting additionalAttributes keys.
 *
 * @param {Object} params - The input parameters
 * @returns {Object} The LDAP attributes object
 */
function buildAttributes(params) {
  // Start with additionalAttributes, then overlay named params
  const merged = { ...(params.additionalAttributes || {}) };
  for (const [param, ldapName] of Object.entries(PARAM_TO_LDAP)) {
    if (params[param] !== undefined) {
      merged[ldapName] = params[param];
    }
  }
  return merged;
}

/**
 * Safely disconnect from LDAP server.
 * Errors during unbind are logged but not thrown to avoid masking original errors.
 * Guards against fd errors from partially-initialized connections.
 *
 * @param {Client} client - The ldapts client
 */
async function safeUnbind(client) {
  if (!client) {
    return;
  }
  try {
    await client.unbind();
  } catch (unbindError) {
    // Suppress fd/socket errors from partially-initialized connections
    const msg = unbindError?.message ?? '';
    if (!msg.includes('fd') && !msg.includes('socket')) {
      console.warn(`Warning: Error during LDAP unbind: ${msg}`);
    }
    // fd/socket errors are expected for failed connections, don't log them
  }
}

export default {
  /**
   * Main execution handler - creates a user in Active Directory.
   *
   * @param {Object} params - Job input parameters
   * @param {string} params.userDN - Distinguished Name for the new user
   * @param {string} params.samAccountName - SAM account name (pre-Windows 2000 name)
   * @param {string} [params.userPrincipalName] - User principal name (email-style login)
   * @param {string} [params.firstName] - First name (givenName)
   * @param {string} [params.lastName] - Last name (sn)
   * @param {string} [params.displayName] - Display name
   * @param {string} [params.email] - Email address (mail)
   * @param {string} [params.company] - Company name
   * @param {string} [params.department] - Department name
   * @param {string} [params.title] - Job title
   * @param {string} [params.password] - Initial password (will be encoded)
   * @param {boolean} [params.enabled] - Create as enabled (default: false/disabled)
   * @param {boolean} [params.changePasswordAtNextLogin] - Force password change at next login
   * @param {Object} [params.additionalAttributes] - Additional LDAP attributes to set
   * @param {boolean} [params.dry_run] - If true, validate without making changes
   * @param {boolean} [params.successIfAlreadyExists] - If true, return success when user already exists
   * @param {Object} context - Execution context with environment and secrets
   * @returns {Object} Job results including status, userDN, and created flag
   */
  invoke: async (params, context) => {
    console.log('Starting Active Directory create user operation');

    const { userDN, dry_run = false, successIfAlreadyExists = false } = params;

    // Validate required parameters
    if (!userDN) {
      throw new Error('userDN is required');
    }

    // Build attributes and validate samAccountName
    const attributes = buildAttributes(params);

    if (!attributes.sAMAccountName) {
      throw new Error('samAccountName is required to create an AD user');
    }

    // Extract CN from DN
    const cn = extractCN(userDN);

    console.log(`Preparing to create user: ${cn}`);
    console.log(`Account will be ${params.enabled === true ? 'enabled' : 'disabled'}`);

    // Handle dry run - validate and return without making changes
    if (dry_run) {
      console.log('DRY RUN: No changes will be made to Active Directory');
      console.log(`Would create user at: ${userDN}`);
      console.log(`With attributes: ${Object.keys(attributes).join(', ')}`);
      return {
        status: 'dry_run_completed',
        userDN,
        created: false,
        attributes: Object.keys(attributes),
        enabled: params.enabled === true
      };
    }

    // Build the LDAP entry
    const entry = {
      objectClass: AD_USER_OBJECT_CLASS,
      cn,
      ...attributes,
      userAccountControl: params.enabled === true ? UAC_ENABLED : UAC_DISABLED
    };

    // Add password if provided (encoded for AD)
    if (params.password) {
      entry.unicodePwd = encodePassword(params.password);
      console.log('Password will be set during user creation');
    }

    // Force password change at next login if requested
    if (params.changePasswordAtNextLogin) {
      entry.pwdLastSet = '0';
      console.log('User will be required to change password at next login');
    }

    // Get LDAP connection details
    const address = getBaseURL(params, context);
    const bindDN = context.secrets.BASIC_USERNAME;
    const bindPassword = context.secrets.BASIC_PASSWORD;

    // Validate required secrets
    if (!bindDN) {
      throw new Error('BASIC_USERNAME secret is required');
    }
    if (!bindPassword) {
      throw new Error('BASIC_PASSWORD secret is required');
    }

    // Configure LDAP client with timeouts
    const clientOptions = {
      url: address,
      timeout: 10000,
      connectTimeout: 10000
    };

    // Configure TLS options for secure connections
    // Only apply TLS options to ldaps:// (encrypted) connections
    // For ldap:// (plain text) connections, TLS options cause connection failures
    if (address.startsWith('ldaps://')) {
      clientOptions.tlsOptions = {
        rejectUnauthorized: context.environment?.TLS_SKIP_VERIFY !== 'true'
      };
    }

    const client = new Client(clientOptions);
    let bound = false; // Track whether bind() succeeded

    try {
      console.log(`Connecting to LDAP server at ${address}`);
      await client.bind(bindDN, bindPassword);
      bound = true; // Only set after successful bind
      console.log('Successfully authenticated to LDAP server');

      console.log(`Creating user: ${userDN}`);
      await client.add(userDN, entry);

      console.log(`Successfully created user: ${userDN}`);
      return {
        status: 'success',
        userDN,
        created: true,
        alreadyExisted: false,
        attributes: Object.keys(attributes),
        address
      };
    } catch (error) {
      // Check if this is an "already exists" error and we should treat it as success
      const errorMessage = error.message.toLowerCase();
      if (successIfAlreadyExists && (errorMessage.includes('already exists') || error.code === 68)) {
        console.log(`User already exists at ${userDN}, treating as success per successIfAlreadyExists flag`);
        return {
          status: 'success',
          userDN,
          created: false,
          alreadyExisted: true,
          attributes: Object.keys(attributes),
          address
        };
      }
      console.error(`Failed to create user: ${error.message}`);
      throw error;
    } finally {
      // Only unbind if we successfully bound to avoid fd errors
      if (bound) {
        await safeUnbind(client);
      }
    }
  },

  /**
   * Error recovery handler - classifies errors and determines retry behavior.
   *
   * @param {Object} params - Original params plus error information
   * @param {Error} params.error - The error that occurred
   * @param {string} params.userDN - The user DN being created
   * @param {Object} _context - Execution context (unused)
   * @throws {Error} Re-throws with appropriate classification
   */
  error: async (params, _context) => {
    const { error, userDN } = params;
    console.error(`Error handler invoked for user "${userDN}": ${error.message}`);

    const errorMessage = error.message.toLowerCase();

    // Authentication errors (fatal - don't retry)
    if (errorMessage.includes('invalid credentials') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('bind failed')) {
      console.error('Authentication failed - check BASIC_USERNAME and BASIC_PASSWORD');
      throw new Error(`LDAP authentication failed: ${error.message}`);
    }

    // Connection errors (retryable - framework will retry)
    if (errorMessage.includes('connection') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('econnrefused')) {
      console.error('Connection error - may be transient, framework will retry');
      throw error;
    }

    // Constraint violations (fatal - don't retry)
    if (errorMessage.includes('constraint violation') ||
        errorMessage.includes('already exists') ||
        errorMessage.includes('invalid syntax')) {
      console.error('Data validation error - check input parameters');
      throw new Error(`Invalid user data: ${error.message}`);
    }

    // Insufficient permissions (fatal - don't retry)
    if (errorMessage.includes('insufficient access') ||
        errorMessage.includes('permission denied')) {
      console.error('Insufficient permissions - check service account privileges');
      throw new Error(`Insufficient LDAP permissions: ${error.message}`);
    }

    // Unknown error - re-throw for framework retry
    console.error('Unknown error occurred, allowing framework to retry');
    throw error;
  },

  /**
   * Graceful shutdown handler - called when the job is halted.
   *
   * @param {Object} params - Original params plus halt reason
   * @param {string} params.reason - The reason for the halt
   * @param {string} [params.userDN] - The user DN being created
   * @param {Object} _context - Execution context (unused)
   * @returns {Object} Cleanup results with halted status
   */
  halt: async (params, _context) => {
    const { reason, userDN } = params;
    console.log(`Active Directory create user operation halted: ${reason}`);

    return {
      status: 'halted',
      userDN: userDN || 'unknown',
      reason,
      halted_at: new Date().toISOString()
    };
  }
};

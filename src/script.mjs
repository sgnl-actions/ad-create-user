import { Client } from 'ldapts';
import { getBaseURL } from '@sgnl-actions/utils';

const AD_USER_OBJECT_CLASS = ['top', 'person', 'organizationalPerson', 'user'];
const UAC_ENABLED = '512';
const UAC_DISABLED = '514';

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

function extractCN(dn) {
  const match = dn.match(/^CN=([^,]+)/i);
  if (!match) {
    throw new Error('userDN must start with CN= (e.g., CN=John Doe,OU=Users,DC=example,DC=com)');
  }
  return match[1];
}

function encodePassword(password) {
  const quoted = `"${password}"`;
  return Buffer.from(quoted, 'utf16le');
}

function buildAttributes(params) {
  const merged = { ...(params.additionalAttributes || {}) };
  for (const [param, ldapName] of Object.entries(PARAM_TO_LDAP)) {
    if (params[param] !== undefined) {
      merged[ldapName] = params[param];
    }
  }
  return merged;
}

async function createUser(userDN, entry, client) {
  await client.add(userDN, entry);
}

export default {
  invoke: async (params, context) => {
    const { userDN, dry_run = false } = params;
    const attributes = buildAttributes(params);

    if (!attributes.sAMAccountName) {
      throw new Error('samAccountName is required to create an AD user');
    }

    const cn = extractCN(userDN);

    if (dry_run) {
      console.log('DRY RUN: No changes will be made to Active Directory');
      return {
        status: 'dry_run_completed',
        userDN,
        created: false,
        attributes: Object.keys(attributes),
        enabled: params.enabled === true
      };
    }

    const entry = {
      objectClass: AD_USER_OBJECT_CLASS,
      cn,
      ...attributes,
      userAccountControl: params.enabled === true ? UAC_ENABLED : UAC_DISABLED
    };

    if (params.password) {
      entry.unicodePwd = encodePassword(params.password);
    }

    if (params.changePasswordAtNextLogin) {
      entry.pwdLastSet = '0';
    }

    const address = getBaseURL(params, context);
    const username = context.secrets.BASIC_USERNAME;
    const password = context.secrets.BASIC_PASSWORD;

    if (!username) {
      throw new Error('BASIC_USERNAME secret is required');
    }
    if (!password) {
      throw new Error('BASIC_PASSWORD secret is required');
    }

    const tlsOptions = {};
    if (context.environment?.TLS_SKIP_VERIFY === 'true') {
      tlsOptions.rejectUnauthorized = false;
    }

    const client = new Client({
      url: address,
      tlsOptions
    });

    try {
      await client.bind(username, password);
      await createUser(userDN, entry, client);

      return {
        status: 'success',
        userDN,
        created: true,
        attributes: Object.keys(attributes),
        address
      };
    } finally {
      await client.unbind();
    }
  },

  error: async (params, _context) => {
    const { error, userDN } = params;
    console.error(`Failed to create AD user ${userDN}: ${error.message}`);

    const errorMessage = error.message.toLowerCase();

    // Authentication errors (fatal - don't retry)
    if (errorMessage.includes('invalid credentials') ||
        errorMessage.includes('authentication') ||
        errorMessage.includes('bind failed')) {
      console.error('Authentication failed - check BASIC_USERNAME and BASIC_PASSWORD');
      throw new Error(`LDAP authentication failed: ${error.message}`);
    }

    // Connection errors (retryable)
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

  halt: async (params, _context) => {
    const { reason, userDN } = params;
    return {
      status: 'halted',
      userDN: userDN || 'unknown',
      reason,
      halted_at: new Date().toISOString()
    };
  }
};

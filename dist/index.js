// SGNL Job Script - Auto-generated bundle
'use strict';

var ldapts = require('ldapts');

/**
 * SGNL Actions - Authentication Utilities
 *
 * Shared authentication utilities for SGNL actions.
 * Supports: Bearer Token, Basic Auth, OAuth2 Client Credentials, OAuth2 Authorization Code
 */


/**
 * Get the base URL/address for API calls
 * @param {Object} params - Request parameters
 * @param {string} [params.address] - Address from params
 * @param {Object} context - Execution context
 * @returns {string} Base URL
 */
function getBaseURL(params, context) {
  const env = context.environment || {};
  const address = params?.address || env.ADDRESS;

  if (!address) {
    throw new Error('No URL specified. Provide address parameter or ADDRESS environment variable');
  }

  // Remove trailing slash if present
  return address.endsWith('/') ? address.slice(0, -1) : address;
}

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

var script = {
  invoke: async (params, context) => {
    const { userDN } = params;
    const attributes = buildAttributes(params);

    if (!attributes.sAMAccountName) {
      throw new Error('samAccountName is required to create an AD user');
    }

    const cn = extractCN(userDN);

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
    if (context.env.TLS_SKIP_VERIFY === 'true') {
      tlsOptions.rejectUnauthorized = false;
    }

    const client = new ldapts.Client({
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
    console.error(`Error creating user ${userDN}: ${error.message}`);
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

module.exports = script;

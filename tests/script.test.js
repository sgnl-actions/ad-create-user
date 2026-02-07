import { jest, describe, test, expect, beforeEach } from '@jest/globals';

const mockBind = jest.fn();
const mockUnbind = jest.fn();
const mockAdd = jest.fn();

jest.unstable_mockModule('ldapts', () => ({
  Client: jest.fn().mockImplementation(() => ({
    bind: mockBind,
    unbind: mockUnbind,
    add: mockAdd
  }))
}));

const mockGetBaseURL = jest.fn().mockReturnValue('ldaps://dc.example.com:636');

jest.unstable_mockModule('@sgnl-actions/utils', () => ({
  getBaseURL: mockGetBaseURL
}));

const { default: script } = await import('../src/script.mjs');
const { Client } = await import('ldapts');

describe('AD Create User Script', () => {
  const mockContext = {
    environment: {
      ADDRESS: 'ldaps://dc.example.com:636'
    },
    secrets: {
      LDAP_BIND_DN: 'CN=admin,DC=example,DC=com',
      LDAP_BIND_PASSWORD: 'password123'
    },
    outputs: {}
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBind.mockResolvedValue(undefined);
    mockUnbind.mockResolvedValue(undefined);
    mockAdd.mockResolvedValue(undefined);
    mockGetBaseURL.mockReturnValue('ldaps://dc.example.com:636');
  });

  describe('invoke handler', () => {
    test('should create user with required attributes', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.userDN).toBe('CN=John Doe,OU=Users,DC=example,DC=com');
      expect(result.created).toBe(true);
      expect(result.attributes).toEqual(['sAMAccountName']);
      expect(mockAdd).toHaveBeenCalledWith(
        'CN=John Doe,OU=Users,DC=example,DC=com',
        {
          objectClass: ['top', 'person', 'organizationalPerson', 'user'],
          cn: 'John Doe',
          sAMAccountName: 'jdoe',
          userAccountControl: '514'
        }
      );
    });

    test('should create user with multiple attributes', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        department: 'Engineering'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.attributes).toEqual(expect.arrayContaining([
        'sAMAccountName', 'givenName', 'sn', 'mail', 'department'
      ]));
      expect(mockAdd).toHaveBeenCalledWith(
        'CN=John Doe,OU=Users,DC=example,DC=com',
        expect.objectContaining({
          objectClass: ['top', 'person', 'organizationalPerson', 'user'],
          cn: 'John Doe',
          sAMAccountName: 'jdoe',
          givenName: 'John',
          sn: 'Doe',
          mail: 'john@example.com',
          department: 'Engineering',
          userAccountControl: '514'
        })
      );
    });

    test('should throw when samAccountName is missing', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        firstName: 'John'
      };

      await expect(script.invoke(params, mockContext)).rejects.toThrow(
        'samAccountName is required to create an AD user'
      );
      expect(mockBind).not.toHaveBeenCalled();
    });

    test('should include objectClass automatically', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await script.invoke(params, mockContext);

      expect(mockAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          objectClass: ['top', 'person', 'organizationalPerson', 'user']
        })
      );
    });

    test('should extract cn from DN', async () => {
      const params = {
        userDN: 'CN=Jane Smith,OU=Users,DC=example,DC=com',
        samAccountName: 'jsmith'
      };

      await script.invoke(params, mockContext);

      expect(mockAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ cn: 'Jane Smith' })
      );
    });

    test('should throw if DN does not start with CN=', async () => {
      const params = {
        userDN: 'OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await expect(script.invoke(params, mockContext)).rejects.toThrow(
        'userDN must start with CN='
      );
      expect(mockBind).not.toHaveBeenCalled();
    });

    test('should create disabled account by default (UAC=514)', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await script.invoke(params, mockContext);

      expect(mockAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ userAccountControl: '514' })
      );
    });

    test('should create enabled account when enabled is true (UAC=512)', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe',
        enabled: true
      };

      await script.invoke(params, mockContext);

      expect(mockAdd).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ userAccountControl: '512' })
      );
    });

    test('should encode and include password when provided', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe',
        password: 'P@ssw0rd!'
      };

      await script.invoke(params, mockContext);

      const callArgs = mockAdd.mock.calls[0][1];
      expect(callArgs.unicodePwd).toBeInstanceOf(Buffer);
      const decoded = callArgs.unicodePwd.toString('utf16le');
      expect(decoded).toBe('"P@ssw0rd!"');
    });

    test('should omit unicodePwd when no password provided', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await script.invoke(params, mockContext);

      const callArgs = mockAdd.mock.calls[0][1];
      expect(callArgs.unicodePwd).toBeUndefined();
    });

    test('should propagate LDAP error code 68 (entry already exists)', async () => {
      mockAdd.mockRejectedValue(
        Object.assign(new Error('Entry already exists'), { code: 68 })
      );

      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await expect(script.invoke(params, mockContext)).rejects.toThrow('Entry already exists');
    });

    test('should propagate LDAP error code 19 (constraint violation)', async () => {
      mockAdd.mockRejectedValue(
        Object.assign(new Error('Constraint violation'), { code: 19 })
      );

      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await expect(script.invoke(params, mockContext)).rejects.toThrow('Constraint violation');
    });

    test('should propagate LDAP error code 17 (undefined attribute type)', async () => {
      mockAdd.mockRejectedValue(
        Object.assign(new Error('Undefined attribute type'), { code: 17 })
      );

      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe',
        additionalAttributes: { nonExistentAttr: 'value' }
      };

      await expect(script.invoke(params, mockContext)).rejects.toThrow('Undefined attribute type');
    });

    test('should propagate bind failure and still call unbind', async () => {
      mockBind.mockRejectedValue(new Error('Bind failed: invalid credentials'));

      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await expect(script.invoke(params, mockContext)).rejects.toThrow('Bind failed: invalid credentials');
      expect(mockUnbind).toHaveBeenCalled();
    });

    test('should throw on missing LDAP_BIND_DN', async () => {
      const context = {
        ...mockContext,
        secrets: { ...mockContext.secrets, LDAP_BIND_DN: '' }
      };

      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await expect(script.invoke(params, context)).rejects.toThrow('LDAP_BIND_DN secret is required');
    });

    test('should throw on missing LDAP_BIND_PASSWORD', async () => {
      const context = {
        ...mockContext,
        secrets: { ...mockContext.secrets, LDAP_BIND_PASSWORD: '' }
      };

      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await expect(script.invoke(params, context)).rejects.toThrow('LDAP_BIND_PASSWORD secret is required');
    });

    test('should set rejectUnauthorized false when TLS_SKIP_VERIFY is true', async () => {
      const context = {
        ...mockContext,
        environment: { ...mockContext.environment, TLS_SKIP_VERIFY: 'true' }
      };

      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await script.invoke(params, context);

      expect(Client).toHaveBeenCalledWith({
        url: 'ldaps://dc.example.com:636',
        timeout: 10000,
        connectTimeout: 10000,
        tlsOptions: { rejectUnauthorized: false }
      });
    });

    test('should set rejectUnauthorized to true for ldaps:// URLs when TLS_SKIP_VERIFY is not set', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await script.invoke(params, mockContext);

      expect(Client).toHaveBeenCalledWith({
        url: 'ldaps://dc.example.com:636',
        timeout: 10000,
        connectTimeout: 10000,
        tlsOptions: { rejectUnauthorized: true }
      });
    });

    test('should not include tlsOptions for ldap:// URLs when TLS_SKIP_VERIFY is not set', async () => {
      mockGetBaseURL.mockReturnValue('ldap://dc.example.com:389');

      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await script.invoke(params, mockContext);

      expect(Client).toHaveBeenCalledWith({
        url: 'ldap://dc.example.com:389',
        timeout: 10000,
        connectTimeout: 10000
      });
    });

    test('should pass address parameter override via getBaseURL', async () => {
      mockGetBaseURL.mockReturnValue('ldaps://override.example.com:636');

      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe',
        address: 'ldaps://override.example.com:636'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.address).toBe('ldaps://override.example.com:636');
    });

    test('should call getBaseURL with params and context', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await script.invoke(params, mockContext);

      expect(mockGetBaseURL).toHaveBeenCalledWith(params, mockContext);
    });

    test('should pass array attribute values through in entry', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe',
        additionalAttributes: {
          otherTelephone: ['+1-555-0100', '+1-555-0101']
        }
      };

      await script.invoke(params, mockContext);

      expect(mockAdd).toHaveBeenCalledWith(
        'CN=John Doe,OU=Users,DC=example,DC=com',
        expect.objectContaining({
          otherTelephone: ['+1-555-0100', '+1-555-0101']
        })
      );
    });

    test('should merge named params with additionalAttributes object', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe',
        firstName: 'John',
        additionalAttributes: {
          telephoneNumber: '+1-555-0100'
        }
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.attributes).toEqual(expect.arrayContaining([
        'telephoneNumber', 'sAMAccountName', 'givenName'
      ]));
    });

    test('should let named params override conflicting attributes keys', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe',
        email: 'named@example.com',
        additionalAttributes: {
          mail: 'attributes@example.com'
        }
      };

      await script.invoke(params, mockContext);

      expect(mockAdd).toHaveBeenCalledWith(
        'CN=John Doe,OU=Users,DC=example,DC=com',
        expect.objectContaining({
          mail: 'named@example.com'
        })
      );
    });

    test('should map all 8 named params to correct LDAP names', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe',
        firstName: 'John',
        lastName: 'Doe',
        displayName: 'John Doe',
        email: 'john@example.com',
        company: 'Example Corp',
        department: 'Engineering',
        title: 'Engineer'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.attributes).toEqual(expect.arrayContaining([
        'sAMAccountName', 'givenName', 'sn', 'displayName',
        'mail', 'company', 'department', 'title'
      ]));
    });

    test('should return only user-supplied attributes in result (not objectClass/cn/UAC)', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe',
        firstName: 'John'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.attributes).toEqual(expect.arrayContaining(['sAMAccountName', 'givenName']));
      expect(result.attributes).not.toContain('objectClass');
      expect(result.attributes).not.toContain('cn');
      expect(result.attributes).not.toContain('userAccountControl');
    });

    test('should throw when userDN is missing', async () => {
      const params = { samAccountName: 'jdoe' };

      await expect(script.invoke(params, mockContext)).rejects.toThrow('userDN is required');
      expect(mockBind).not.toHaveBeenCalled();
    });

    test('should handle unbind errors gracefully', async () => {
      mockUnbind.mockRejectedValueOnce(new Error('Unbind failed'));

      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('success');
      expect(result.created).toBe(true);
    });

    test('should not mask original error when unbind also fails', async () => {
      mockAdd.mockRejectedValueOnce(new Error('Add operation failed'));
      mockUnbind.mockRejectedValueOnce(new Error('Unbind failed'));

      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe'
      };

      await expect(script.invoke(params, mockContext)).rejects.toThrow('Add operation failed');
    });

    test('should return dry_run_completed when dry_run is true', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        samAccountName: 'jdoe',
        dry_run: true
      };

      const result = await script.invoke(params, mockContext);

      expect(result.status).toBe('dry_run_completed');
      expect(result.userDN).toBe('CN=John Doe,OU=Users,DC=example,DC=com');
      expect(result.created).toBe(false);
      expect(result.attributes).toEqual(['sAMAccountName']);
      expect(mockBind).not.toHaveBeenCalled();
      expect(mockAdd).not.toHaveBeenCalled();
    });
  });

  describe('error handler', () => {
    test('should re-throw connection errors for framework retry', async () => {
      const error = new Error('LDAP connection failed');
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('LDAP connection failed');
    });

    test('should wrap authentication errors', async () => {
      const error = new Error('Invalid credentials');
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('LDAP authentication failed');
    });

    test('should wrap permission errors', async () => {
      const error = new Error('Insufficient access rights');
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Insufficient LDAP permissions');
    });

    test('should wrap constraint violation errors', async () => {
      const error = new Error('Constraint violation');
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        error
      };

      await expect(script.error(params, mockContext)).rejects.toThrow('Invalid user data');
    });
  });

  describe('halt handler', () => {
    test('should return halted status with userDN', async () => {
      const params = {
        userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
        reason: 'timeout'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.userDN).toBe('CN=John Doe,OU=Users,DC=example,DC=com');
      expect(result.reason).toBe('timeout');
      expect(result.halted_at).toBeDefined();
    });

    test('should handle halt without userDN', async () => {
      const params = {
        reason: 'system_shutdown'
      };

      const result = await script.halt(params, mockContext);

      expect(result.status).toBe('halted');
      expect(result.userDN).toBe('unknown');
      expect(result.reason).toBe('system_shutdown');
    });
  });
});

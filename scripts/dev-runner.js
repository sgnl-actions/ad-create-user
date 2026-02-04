#!/usr/bin/env node

/**
 * Development runner for testing scripts locally
 */

import script from '../src/script.mjs';

const mockContext = {
  env: {
    ADDRESS: 'ldaps://dc.example.com:636',
  },
  secrets: {
    BASIC_USERNAME: 'CN=admin,DC=example,DC=com',
    BASIC_PASSWORD: 'admin-password',
  },
  outputs: {},
  partial_results: {},
  current_step: 'start',
};

const mockParams = {
  userDN: 'CN=John Doe,OU=Users,DC=example,DC=com',
  samAccountName: 'jdoe',
  firstName: 'John',
  lastName: 'Doe',
  email: 'john.doe@example.com',
  department: 'Engineering',
  title: 'Software Engineer',
  enabled: true,
  attributes: {
    telephoneNumber: '+1-555-0100',
  },
};

async function runDev() {
  console.log('Running job script in development mode...\n');

  console.log('Parameters:', JSON.stringify(mockParams, null, 2));
  console.log('Context:', JSON.stringify(mockContext, null, 2));
  console.log('\n' + '='.repeat(50) + '\n');

  try {
    const result = await script.invoke(mockParams, mockContext);
    console.log('\n' + '='.repeat(50));
    console.log('Job completed successfully!');
    console.log('Result:', JSON.stringify(result, null, 2));
  } catch (error) {
    console.log('\n' + '='.repeat(50));
    console.error('Job failed:', error.message);

    if (script.error) {
      console.log('\nAttempting error recovery...');
      try {
        const recovery = await script.error({...mockParams, error}, mockContext);
        console.log('Recovery successful!');
        console.log('Recovery result:', JSON.stringify(recovery, null, 2));
      } catch (recoveryError) {
        console.error('Recovery failed:', recoveryError.message);
      }
    }
  }
}

runDev().catch(console.error);

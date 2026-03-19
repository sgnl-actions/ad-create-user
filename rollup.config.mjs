import json from '@rollup/plugin-json';
import { createConfig } from '@sgnl-actions/rollup-config';

export default createConfig({
  inlineDynamicImports: true,
  plugins: [json()]
});

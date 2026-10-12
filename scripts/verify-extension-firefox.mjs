// Installed Firefox; automated permission API setup is not native prompt/OS testing.
import { withClipRuntime } from './verify-clip-delivery-runtime.mjs';
import { verifyExtensionBoundaries } from './verify-extension-boundary-suite.mjs';

await withClipRuntime('firefox', context => verifyExtensionBoundaries(context, 'firefox'));

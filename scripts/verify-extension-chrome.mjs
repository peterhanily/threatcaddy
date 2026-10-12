// Installed Chrome, disposable profile, synthetic loopback fixtures only.
import { withClipRuntime } from './verify-clip-delivery-runtime.mjs';
import { verifyExtensionBoundaries } from './verify-extension-boundary-suite.mjs';

await withClipRuntime('chrome', context => verifyExtensionBoundaries(context, 'chrome'));

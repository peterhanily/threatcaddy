// Build the hosted app and extension first. Never uses an existing browser profile.
import { withClipRuntime } from './verify-clip-delivery-runtime.mjs';
import { verifyClipDelivery } from './verify-clip-delivery-suite.mjs';

await withClipRuntime('chrome', verifyClipDelivery);

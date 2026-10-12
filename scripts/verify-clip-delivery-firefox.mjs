// Real Firefox + WebDriver BiDi; native permission prompts are intentionally excluded.
import { withClipRuntime } from './verify-clip-delivery-runtime.mjs';
import { verifyClipDelivery } from './verify-clip-delivery-suite.mjs';

await withClipRuntime('firefox', verifyClipDelivery);

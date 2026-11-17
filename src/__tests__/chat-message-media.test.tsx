/**
 * C-MEDIA-1: chat, agent-audit and meeting messages never load remote media,
 * so text a model was steered into writing cannot beacon when it is displayed.
 */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatMessageBubble } from '../components/Chat/ChatMessage';

afterEach(cleanup);

const beacon = 'https://c.example/?d=1';

describe('C-MEDIA-1 chat messages render no remote media', () => {
  it.each([
    ['markdown image', `Result ![x](${beacon})`],
    ['HTML image', `Result <img src="${beacon}">`],
    ['meeting turn', `**🛡️ CISO:** Result ![x](${beacon})`],
    ['media elements', `Result <video poster="${beacon}"></video><audio src="${beacon}"></audio><picture><source srcset="${beacon}"></picture><svg><image href="${beacon}"/></svg>`],
  ])('an assistant %s', (_label, content) => {
    const { container } = render(<ChatMessageBubble role="assistant" content={content} />);
    expect(container.innerHTML).not.toMatch(/<(?:img|image|video|audio|source|picture|svg)\b/);
    expect(container.innerHTML).not.toContain(beacon);
    expect(container.textContent).toContain('Result');
  });

  it('keeps links and the analyst\'s own pasted images', () => {
    const { container } = render(<ChatMessageBubble role="assistant" content="See [the advisory](https://www.cisa.gov/advisory)" />);
    expect(container.querySelector('a')?.getAttribute('href')).toBe('https://www.cisa.gov/advisory');
    cleanup();
    const attachment = { type: 'image' as const, name: 'screenshot.png', mimeType: 'image/png', data: 'iVBORw0KGgo=' };
    const user = render(<ChatMessageBubble role="user" content="Look" attachments={[attachment]} />);
    expect(user.container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
  });
});

export function aiTabJs(): string {
  return `/* ═══ AI ASSISTANT TAB ═══════════════════════════════════════ */

var aiMessages = [];
var aiStreaming = false;

function sendAiMessage() {
  if (aiStreaming) return;
  var input = document.getElementById('aiInput');
  var text = input.value.trim();
  if (!text) return;
  input.value = '';

  aiMessages.push({ role: 'user', content: text });
  appendAiMessage('user', text);
  runAiChat();
}

function clearAiChat() {
  aiMessages = [];
  document.getElementById('aiChatArea').innerHTML =
    '<div style="text-align:center;color:#8b949e;padding:2rem;">Ask me anything about your server -- users, bots, investigations, audit logs, and more.</div>';
}

function appendAiMessage(role, content) {
  var area = document.getElementById('aiChatArea');
  // Clear placeholder
  var placeholder = area.querySelector('[style*="text-align:center"]');
  if (placeholder) area.innerHTML = '';

  var div = document.createElement('div');
  div.style.cssText = 'margin-bottom:1rem;padding:0.75rem;background:' + (role === 'user' ? '#1c2128' : '#161b22') + ';border:1px solid ' + (role === 'user' ? '#30363d' : '#21262d') + ';border-radius:8px;';
  div.innerHTML = role === 'user'
    ? '<div style="font-size:0.75rem;color:#58a6ff;font-weight:600;margin-bottom:0.25rem;">You</div><div style="font-size:0.85rem;color:#c9d1d9;white-space:pre-wrap;word-break:break-word;">' + esc(content) + '</div>'
    : '<div style="font-size:0.75rem;color:#3fb950;font-weight:600;margin-bottom:0.25rem;">Assistant</div><span class="ai-text" style="font-size:0.85rem;color:#c9d1d9;white-space:pre-wrap;word-break:break-word;"></span>';
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
  return div;
}

function runAiChat() {
  aiStreaming = true;
  var sendBtn = document.getElementById('aiSendBtn');
  sendBtn.disabled = true;
  sendBtn.textContent = 'Thinking...';

  var msgDiv = appendAiMessage('assistant', '');
  var textSpan = msgDiv.querySelector('.ai-text');
  var fullText = '';

  fetch(BASE + '/admin/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ messages: aiMessages }),
  }).then(function(resp) {
    if (!resp.ok) {
      return resp.json().then(function(d) { throw new Error(d.error || 'Request failed'); });
    }
    var reader = resp.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';

    function processChunk() {
      return reader.read().then(function(result) {
        if (result.done) {
          finishAiStream(fullText);
          return;
        }
        buffer += decoder.decode(result.value, { stream: true });
        var lines = buffer.split('\\n');
        buffer = lines.pop() || '';

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim();
          if (!line.startsWith('data:')) continue;
          var jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;
          try {
            var evt = JSON.parse(jsonStr);
            if (evt.type === 'text') {
              fullText += evt.text;
              textSpan.innerHTML = formatAiText(fullText);
              document.getElementById('aiChatArea').scrollTop = document.getElementById('aiChatArea').scrollHeight;
            } else if (evt.type === 'tool_call') {
              var toolDiv = document.createElement('div');
              toolDiv.style.cssText = 'font-size:0.75rem;color:#d29922;margin-top:0.5rem;padding:0.3rem 0.5rem;background:#0d1117;border-radius:4px;';
              toolDiv.innerHTML = (evt.requiresConfirm ? '! ' : '> ') + 'Calling <strong>' + esc(evt.name) + '</strong>';
              msgDiv.appendChild(toolDiv);
            } else if (evt.type === 'tool_result') {
              var resDiv = document.createElement('div');
              resDiv.style.cssText = 'font-size:0.75rem;color:#58a6ff;margin-top:0.25rem;padding:0.3rem 0.5rem;background:#0d1117;border-radius:4px;max-height:150px;overflow:auto;';
              resDiv.innerHTML = 'Result: ' + esc(evt.name);
              msgDiv.appendChild(resDiv);
            } else if (evt.type === 'error') {
              textSpan.innerHTML += '<span style="color:#f85149;">[Error: ' + esc(evt.error) + ']</span>';
            }
          } catch (e) { /* ignore parse errors in SSE stream */ }
        }
        return processChunk();
      });
    }
    return processChunk();
  }).catch(function(err) {
    textSpan.innerHTML = '<span style="color:#f85149;">Error: ' + esc(err.message) + '</span>';
    finishAiStream('');
  });
}

function finishAiStream(text) {
  aiStreaming = false;
  var sendBtn = document.getElementById('aiSendBtn');
  sendBtn.disabled = false;
  sendBtn.textContent = 'Send';
  if (text) {
    aiMessages.push({ role: 'assistant', content: text });
  }
}

function formatAiText(text) {
  return esc(text)
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\\`([^\\\`]+)\\\`/g, '<code style="background:#161b22;padding:1px 4px;border-radius:3px;">$1</code>')
    .replace(/\\n/g, '<br>');
}

document.getElementById('aiSendBtn').addEventListener('click', function() { sendAiMessage(); });
document.getElementById('aiInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendAiMessage();
  }
});
document.getElementById('aiClearBtn').addEventListener('click', function() { clearAiChat(); });`;
}

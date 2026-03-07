export function aiTabJs(): string {
  return `/* ═══ AI ASSISTANT TAB ═══════════════════════════════════════ */

var aiMessages = [];
var aiStreaming = false;
var aiProvidersLoaded = false;
var aiSettingsLoaded = false;

function loadAiProviders() {
  if (aiProvidersLoaded) return;
  aiProvidersLoaded = true;
  fetch(BASE + '/admin/api/ai/providers', {
    headers: { 'Authorization': 'Bearer ' + token },
  }).then(function(r) { return r.json(); }).then(function(data) {
    var sel = document.getElementById('aiProviderSelect');
    var modelSel = document.getElementById('aiModelSelect');
    sel.innerHTML = '';
    if (!data.providers || data.providers.length === 0) {
      sel.innerHTML = '<option value="">No providers configured</option>';
      modelSel.innerHTML = '<option value="">—</option>';
      document.getElementById('aiProviderHint').textContent = 'Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or MISTRAL_API_KEY on the server, or configure a local LLM endpoint in Settings.';
      document.getElementById('aiProviderHint').style.display = 'block';
      return;
    }
    document.getElementById('aiProviderHint').style.display = 'none';
    window._aiProviders = data.providers;
    var labels = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Gemini', mistral: 'Mistral', local: 'Local LLM' };
    for (var i = 0; i < data.providers.length; i++) {
      var p = data.providers[i];
      var opt = document.createElement('option');
      opt.value = p.provider;
      opt.textContent = labels[p.provider] || p.provider;
      sel.appendChild(opt);
    }
    // Select default provider if configured
    if (data.settings && data.settings.defaultProvider) {
      var defP = data.settings.defaultProvider;
      if (data.providers.some(function(p) { return p.provider === defP; })) {
        sel.value = defP;
      }
    }
    updateAiModels();
    // Select default model if configured
    if (data.settings && data.settings.defaultModel) {
      var defM = data.settings.defaultModel;
      if (modelSel.querySelector('option[value="' + defM + '"]')) {
        modelSel.value = defM;
      }
    }
  }).catch(function() {
    document.getElementById('aiProviderHint').textContent = 'Failed to load providers.';
    document.getElementById('aiProviderHint').style.display = 'block';
  });
  // Also load settings
  loadAiSettings();
}

function updateAiModels() {
  var provider = document.getElementById('aiProviderSelect').value;
  var modelSel = document.getElementById('aiModelSelect');
  modelSel.innerHTML = '';
  if (!window._aiProviders) return;
  for (var i = 0; i < window._aiProviders.length; i++) {
    if (window._aiProviders[i].provider === provider) {
      var models = window._aiProviders[i].models;
      for (var j = 0; j < models.length; j++) {
        var opt = document.createElement('option');
        opt.value = models[j];
        opt.textContent = models[j];
        modelSel.appendChild(opt);
      }
      break;
    }
  }
}

/* ═══ AI SETTINGS ═══════════════════════════════════════════ */

function loadAiSettings() {
  if (aiSettingsLoaded) return;
  aiSettingsLoaded = true;
  fetch(BASE + '/admin/api/ai/settings', {
    headers: { 'Authorization': 'Bearer ' + token },
  }).then(function(r) { return r.json(); }).then(function(data) {
    document.getElementById('aiLocalEndpoint').value = data.localEndpoint || '';
    document.getElementById('aiLocalApiKey').value = data.localApiKey === '***configured***' ? '' : (data.localApiKey || '');
    if (data.localApiKey === '***configured***') {
      document.getElementById('aiLocalApiKey').placeholder = '***configured*** (leave blank to keep)';
    }
    document.getElementById('aiLocalModel').value = data.localModelName || '';
    document.getElementById('aiCustomPrompt').value = data.customSystemPrompt || '';
    document.getElementById('aiTemperature').value = data.temperature !== undefined ? data.temperature : 0.7;
  }).catch(function() {});
}

function saveAiSettings() {
  var body = {
    localEndpoint: document.getElementById('aiLocalEndpoint').value.trim(),
    localModelName: document.getElementById('aiLocalModel').value.trim(),
    customSystemPrompt: document.getElementById('aiCustomPrompt').value,
    temperature: parseFloat(document.getElementById('aiTemperature').value) || 0.7,
  };
  // Only send API key if user typed something
  var apiKeyInput = document.getElementById('aiLocalApiKey');
  if (apiKeyInput.value) {
    body.localApiKey = apiKeyInput.value;
  }

  api('/ai/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  }).then(function(data) {
    toast('AI settings saved');
    // Reload providers to pick up local endpoint changes
    aiProvidersLoaded = false;
    loadAiProviders();
    if (data.localApiKey === '***configured***') {
      apiKeyInput.value = '';
      apiKeyInput.placeholder = '***configured*** (leave blank to keep)';
    }
  }).catch(function(err) { toast(err.message, 'error'); });
}

/* ═══ CHAT ══════════════════════════════════════════════════ */

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
    '<div style="text-align:center;color:#8b949e;padding:2rem;">Ask me anything about your server — users, bots, investigations, audit logs, and more.</div>';
}

function appendAiMessage(role, content) {
  var area = document.getElementById('aiChatArea');
  var placeholder = area.querySelector('[style*="text-align:center"]');
  if (placeholder) area.innerHTML = '';

  var div = document.createElement('div');
  div.className = 'ai-msg ai-msg-' + role;
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

  var provider = document.getElementById('aiProviderSelect').value;
  var model = document.getElementById('aiModelSelect').value;

  fetch(BASE + '/admin/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify({ messages: aiMessages, provider: provider, model: model }),
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
        var lines = buffer.split('\\\\n');
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
              toolDiv.className = 'ai-tool-call';
              toolDiv.innerHTML = (evt.requiresConfirm ? '! ' : '> ') + 'Calling <strong>' + esc(evt.name) + '</strong>';
              msgDiv.appendChild(toolDiv);
            } else if (evt.type === 'tool_result') {
              var resDiv = document.createElement('div');
              resDiv.className = 'ai-tool-result';
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
    .replace(/\\\\*\\\\*(.+?)\\\\*\\\\*/g, '<strong>$1</strong>')
    .replace(/\\\\\\\`([^\\\\\\\`]+)\\\\\\\`/g, '<code style="background:#161b22;padding:1px 4px;border-radius:3px;">$1</code>')
    .replace(/\\\\n/g, '<br>');
}

/* ═══ EVENT LISTENERS ═══════════════════════════════════════ */

document.getElementById('aiSendBtn').addEventListener('click', function() { sendAiMessage(); });
document.getElementById('aiInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendAiMessage();
  }
});
document.getElementById('aiClearBtn').addEventListener('click', function() { clearAiChat(); });
document.getElementById('aiProviderSelect').addEventListener('change', function() { updateAiModels(); });
document.getElementById('aiSettingsToggle').addEventListener('click', function() {
  var panel = document.getElementById('aiSettingsPanel');
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
});
document.getElementById('aiSettingsSave').addEventListener('click', function() { saveAiSettings(); });`;
}

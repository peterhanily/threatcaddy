import { aiStreamJs } from './ai-stream.js';

export function aiTabJs(): string {
  return aiStreamJs() + String.raw`
var aiMessages = [];
var aiStreaming = false;
var aiProvidersLoaded = false;
var aiSettingsLoaded = false;
var aiSettingsHasSnapshot = false;
var aiProvidersLoading = false;
var aiProvidersRevision = 0;
var aiProvidersController = null;
var aiSettingsLoading = false;
var aiSettingsSaving = false;
var aiSettingsRevision = 0;
var aiSettingsDirty = false;
var aiHistoryBlocked = false;
var aiSessionGeneration = 0;
var aiChatGeneration = 0;
var aiControllers = new Set();
var aiChatController = null;
var aiApproval = null;

function aiOwnsSession(generation, sessionToken) {
  return generation === aiSessionGeneration && sessionToken === token && !!token;
}
function aiSetStatus(text) { document.getElementById('aiStatus').textContent = text || ''; }
function aiUpdateControls() {
  var button = document.getElementById('aiSendBtn');
  button.disabled = aiStreaming || !!aiApproval || aiHistoryBlocked || !aiProvidersLoaded || aiProvidersLoading || !document.getElementById('aiProviderSelect').value;
  button.textContent = aiStreaming ? 'Thinking...' : 'Send';
}
function aiController() { var controller = new AbortController(); aiControllers.add(controller); return controller; }
function aiUpdateSettingsControls() {
  ['aiLocalEndpoint','aiLocalApiKey','aiLocalModel','aiCustomPrompt','aiTemperature'].forEach(function(id) {
    document.getElementById(id).disabled = !aiSettingsHasSnapshot;
  });
  document.getElementById('aiSettingsSave').disabled = aiSettingsSaving || !aiSettingsHasSnapshot;
}

async function aiReadJSON(response) {
  if (!response.body) throw new Error('Empty server response.');
  var reader = response.body.getReader();
  var decoder = new TextDecoder('utf-8', { fatal: true });
  var text = '';
  var size = 0;
  try {
    while (true) {
      var part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 256 * 1024) throw new Error('Server response exceeds the size limit.');
      text += decoder.decode(part.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel().catch(function() {}); reader.releaseLock(); }
}
async function aiRequestJSON(path, options, controller, sessionToken) {
  var generation = aiSessionGeneration;
  var timer = setTimeout(function() { controller.abort(); }, 130000);
  try {
    var response = await fetch(BASE + '/admin/api' + path, Object.assign({}, options, {
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sessionToken }, signal: controller.signal,
    }));
    var data = await aiReadJSON(response);
    if (!response.ok) {
      if (response.status === 401 && aiOwnsSession(generation, sessionToken)) logout();
      var error = new Error(data && typeof data.error === 'string' ? data.error : 'Request failed.');
      error.status = response.status;
      throw error;
    }
    return data;
  } finally { clearTimeout(timer); }
}

async function loadAiProviders() {
  loadAiSettings();
  if (!token || aiProvidersLoaded || aiProvidersLoading) return;
  var generation = aiSessionGeneration;
  var revision = aiProvidersRevision;
  var sessionToken = token;
  var controller = aiController();
  aiProvidersController = controller; aiProvidersLoading = true; aiUpdateControls();
  try {
    var data = await aiRequestJSON('/ai/providers', {}, controller, sessionToken);
    if (!aiOwnsSession(generation, sessionToken) || revision !== aiProvidersRevision) return;
    if (!data || !Array.isArray(data.providers) || data.providers.some(function(p) {
      return !p || typeof p.provider !== 'string' || !Array.isArray(p.models) || p.models.some(function(m) { return typeof m !== 'string'; });
    })) throw new Error('Invalid provider list.');
    var select = document.getElementById('aiProviderSelect');
    var previous = select.value;
    select.replaceChildren();
    window._aiProviders = data.providers;
    var labels = { anthropic: 'Anthropic', openai: 'OpenAI', gemini: 'Gemini', mistral: 'Mistral', local: 'Local LLM' };
    data.providers.forEach(function(provider) {
      var option = document.createElement('option'); option.value = provider.provider;
      option.textContent = labels[provider.provider] || provider.provider; select.appendChild(option);
    });
    var selected = previous || (data.settings && data.settings.defaultProvider);
    if (data.providers.some(function(p) { return p.provider === selected; })) select.value = selected;
    var hint = document.getElementById('aiProviderHint');
    hint.textContent = data.providers.length ? '' : 'No AI providers configured. Ask your administrator to configure a provider.';
    hint.style.display = data.providers.length ? 'none' : 'block';
    updateAiModels();
    var model = data.settings && data.settings.defaultModel;
    var models = document.getElementById('aiModelSelect');
    if (Array.from(models.options).some(function(option) { return option.value === model; })) models.value = model;
    aiProvidersLoaded = true;
  } catch (error) {
    if (aiOwnsSession(generation, sessionToken) && revision === aiProvidersRevision) {
      var hint = document.getElementById('aiProviderHint');
      hint.textContent = 'Could not load providers. Use Reload providers to retry.'; hint.style.display = 'block';
    }
  } finally {
    aiControllers.delete(controller);
    if (aiOwnsSession(generation, sessionToken)) {
      aiProvidersLoading = false; aiProvidersController = null;
      // Coalesce invalidations while an older read was pending. A stale response
      // never publishes, and the newest requested revision gets one fresh read.
      if (revision !== aiProvidersRevision) loadAiProviders();
      aiUpdateControls();
    }
  }
}
function refreshAiProviders() {
  aiProvidersRevision++; aiProvidersLoaded = false;
  if (aiProvidersController) aiProvidersController.abort();
  loadAiProviders(); aiUpdateControls();
}
function updateAiModels() {
  var select = document.getElementById('aiModelSelect'); var previous = select.value; select.replaceChildren();
  var provider = (window._aiProviders || []).find(function(p) { return p.provider === document.getElementById('aiProviderSelect').value; });
  (provider ? provider.models : []).forEach(function(model) {
    var option = document.createElement('option'); option.value = model; option.textContent = model; select.appendChild(option);
  });
  if (Array.from(select.options).some(function(option) { return option.value === previous; })) select.value = previous;
  aiUpdateControls();
}

async function loadAiSettings() {
  if (!token || aiSettingsLoaded || aiSettingsLoading) return;
  var generation = aiSessionGeneration; var sessionToken = token; var revision = aiSettingsRevision; var controller = aiController();
  aiSettingsLoading = true; aiUpdateSettingsControls();
  if (!aiSettingsHasSnapshot) document.getElementById('aiSettingsStatus').textContent = 'Loading AI settings before editing is available…';
  try {
    var data = await aiRequestJSON('/ai/settings', {}, controller, sessionToken);
    if (!aiOwnsSession(generation, sessionToken)) return;
    if (!data || typeof data !== 'object' || Array.isArray(data)
      || ['localEndpoint','localApiKey','localModelName','customSystemPrompt'].some(function(key) { return typeof data[key] !== 'string'; })
      || typeof data.temperature !== 'number' || !Number.isFinite(data.temperature) || data.temperature < 0 || data.temperature > 2) throw new Error('Invalid settings response.');
    if (!aiSettingsDirty && revision === aiSettingsRevision) {
      document.getElementById('aiLocalEndpoint').value = data.localEndpoint || '';
      document.getElementById('aiLocalApiKey').value = '';
      document.getElementById('aiLocalApiKey').placeholder = data.localApiKey === '***configured***' ? 'Configured (leave blank to keep)' : 'Leave blank if not needed';
      document.getElementById('aiLocalModel').value = data.localModelName || '';
      document.getElementById('aiCustomPrompt').value = data.customSystemPrompt || '';
      document.getElementById('aiTemperature').value = data.temperature !== undefined ? data.temperature : 0.7;
    }
    if (revision === aiSettingsRevision) document.getElementById('aiSettingsStatus').textContent = aiSettingsDirty ? 'Unsaved settings edits have been kept.' : '';
    aiSettingsLoaded = true; aiSettingsHasSnapshot = true;
  } catch (error) {
    if (aiOwnsSession(generation, sessionToken) && revision === aiSettingsRevision) document.getElementById('aiSettingsStatus').textContent = 'Could not load settings. Use Reload providers to retry; your edits are unchanged.';
  } finally {
    aiControllers.delete(controller);
    if (aiOwnsSession(generation, sessionToken)) { aiSettingsLoading = false; aiUpdateSettingsControls(); }
  }
}
async function saveAiSettings() {
  if (!token || aiSettingsSaving || !aiSettingsHasSnapshot) return;
  var temperatureText = document.getElementById('aiTemperature').value.trim(); var temperature = Number(temperatureText);
  if (!temperatureText || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    document.getElementById('aiSettingsStatus').textContent = 'Temperature must be a number from 0 to 2.';
    document.getElementById('aiTemperature').focus(); return;
  }
  var generation = aiSessionGeneration; var sessionToken = token; var revision = ++aiSettingsRevision; var controller = aiController();
  var keyInput = document.getElementById('aiLocalApiKey');
  var body = { localEndpoint: document.getElementById('aiLocalEndpoint').value.trim(), localModelName: document.getElementById('aiLocalModel').value.trim(),
    customSystemPrompt: document.getElementById('aiCustomPrompt').value, temperature: temperature };
  if (keyInput.value) body.localApiKey = keyInput.value;
  aiSettingsSaving = true; document.getElementById('aiSettingsSave').disabled = true;
  try {
    var data = await aiRequestJSON('/ai/settings', { method: 'PATCH', body: JSON.stringify(body) }, controller, sessionToken);
    if (!aiOwnsSession(generation, sessionToken)) return;
    if (revision === aiSettingsRevision) {
      aiSettingsDirty = false; keyInput.value = '';
      keyInput.placeholder = data.localApiKey === '***configured***' ? 'Configured (leave blank to keep)' : 'Leave blank if not needed';
    }
    document.getElementById('aiSettingsStatus').textContent = revision === aiSettingsRevision ? 'AI settings saved.' : 'Earlier settings saved. Your newer unsaved edits have been kept.';
    refreshAiProviders();
  } catch (error) {
    if (aiOwnsSession(generation, sessionToken)) document.getElementById('aiSettingsStatus').textContent = 'Could not save AI settings. Your edits are unchanged; retry after checking the connection.';
  } finally {
    aiControllers.delete(controller);
    if (aiOwnsSession(generation, sessionToken)) { aiSettingsSaving = false; aiUpdateSettingsControls(); }
  }
}
function aiHistoryFits(messages) {
  return messages.length <= 50 && messages.every(function(message) { return message.content.length <= 20000; })
    && new TextEncoder().encode(JSON.stringify(messages)).byteLength <= 128 * 1024;
}
function sendAiMessage() {
  if (!token || aiStreaming || aiApproval) return;
  var input = document.getElementById('aiInput'); var text = input.value.trim();
  if (!text) return;
  if (!aiProvidersLoaded || aiProvidersLoading) { aiSetStatus('Wait for the current provider list before sending. Your draft has been kept.'); return; }
  if (!document.getElementById('aiProviderSelect').value || !document.getElementById('aiModelSelect').value) {
    aiSetStatus('Select a configured provider and model before sending.'); return;
  }
  var messages = aiMessages.concat([{ role: 'user', content: text }]);
  if (aiHistoryBlocked || !aiHistoryFits(messages)) {
    aiSetStatus('Message or conversation is too large. Keep this draft, shorten it or clear the conversation before sending. Nothing was sent.'); return;
  }
  input.value = ''; aiMessages = messages; aiSetStatus(''); appendAiMessage('user', text); runAiChat();
}
function appendAiMessage(role, content) {
  var area = document.getElementById('aiChatArea'); var placeholder = area.querySelector('.ai-placeholder');
  if (placeholder) placeholder.remove();
  var div = document.createElement('div'); div.className = 'ai-msg ai-msg-' + role;
  var label = document.createElement('strong'); label.textContent = role === 'user' ? 'You' : 'Assistant'; div.appendChild(label);
  var text = document.createElement('div'); text.className = 'ai-text'; text.style.whiteSpace = 'pre-wrap'; text.style.overflowWrap = 'anywhere'; text.textContent = content; div.appendChild(text);
  area.appendChild(div); area.scrollTop = area.scrollHeight; return div;
}
function aiNotice(parent, text, error) {
  var notice = document.createElement('div'); notice.className = 'ai-tool-result'; notice.textContent = text;
  if (error) { notice.style.color = '#f85149'; notice.setAttribute('role', 'alert'); }
  parent.appendChild(notice); return notice;
}
function clearAiChat(fromLogout) {
  var uncertain = aiApproval && aiApproval.decision;
  aiChatGeneration++;
  if (aiChatController) aiChatController.abort(); aiChatController = null;
  if (aiApproval) { clearInterval(aiApproval.timer); if (aiApproval.controller) aiApproval.controller.abort(); }
  aiApproval = null; aiStreaming = false; aiMessages = []; aiHistoryBlocked = false;
  var area = document.getElementById('aiChatArea'); area.replaceChildren();
  var placeholder = document.createElement('div'); placeholder.className = 'ai-placeholder';
  placeholder.textContent = 'Ask about your server — users, bots, investigations, audit logs, and more.'; area.appendChild(placeholder);
  aiSetStatus(!fromLogout && uncertain ? 'Chat cleared. A submitted action may already have completed; check Audit Log before requesting it again.' : '');
  aiUpdateControls();
}
function resetAiSession() {
  aiSessionGeneration++; aiControllers.forEach(function(controller) { controller.abort(); }); aiControllers.clear(); clearAiChat(true);
  aiProvidersLoaded = false; aiSettingsLoaded = false; aiSettingsHasSnapshot = false; aiProvidersLoading = false; aiSettingsLoading = false; aiSettingsSaving = false;
  aiProvidersRevision = 0; aiProvidersController = null;
  aiSettingsRevision = 0; aiSettingsDirty = false; window._aiProviders = [];
  ['aiLocalEndpoint','aiLocalApiKey','aiLocalModel','aiCustomPrompt','aiInput'].forEach(function(id) { document.getElementById(id).value = ''; });
  document.getElementById('aiLocalApiKey').placeholder = 'Leave blank if not needed'; document.getElementById('aiTemperature').value = '0.7';
  document.getElementById('aiProviderSelect').replaceChildren(); document.getElementById('aiModelSelect').replaceChildren();
  document.getElementById('aiProviderHint').textContent = ''; document.getElementById('aiSettingsStatus').textContent = '';
  aiUpdateSettingsControls(); document.getElementById('aiSettingsPanel').style.display = 'none'; aiUpdateControls();
}

function showAiApproval(event, parent, generation, sessionGeneration, sessionToken) {
  var approval = { id: event.approvalId, name: event.name, expiresAt: event.expiresAt,
    inputText: JSON.stringify(event.input, null, 2), generation: generation, sessionGeneration: sessionGeneration,
    sessionToken: sessionToken, decision: null, busy: false, finished: false, controller: null, timer: null };
  aiApproval = approval;
  var card = document.createElement('section'); card.className = 'ai-tool-call'; card.setAttribute('aria-label', 'Administrative action approval');
  var heading = document.createElement('h3'); heading.textContent = 'Review exact administrative action'; card.appendChild(heading);
  var name = document.createElement('strong'); name.textContent = approval.name; card.appendChild(name);
  var input = document.createElement('pre'); input.style.whiteSpace = 'pre-wrap'; input.style.overflowWrap = 'anywhere';
  input.setAttribute('aria-label', 'Exact action arguments'); input.textContent = approval.inputText; card.appendChild(input);
  var expiry = document.createElement('p'); expiry.textContent = 'Approval expires: ' + new Date(approval.expiresAt).toLocaleString(); card.appendChild(expiry);
  var status = document.createElement('p'); status.setAttribute('role', 'status'); status.textContent = 'Nothing has been approved or executed. Review the exact action above.'; card.appendChild(status);
  var approve = document.createElement('button'); approve.className = 'btn btn-danger btn-sm'; approve.textContent = 'Approve exact action';
  var reject = document.createElement('button'); reject.className = 'btn btn-outline btn-sm'; reject.textContent = 'Reject action';
  var retry = document.createElement('button'); retry.className = 'btn btn-outline btn-sm'; retry.textContent = 'Retry same action receipt'; retry.hidden = true; retry.style.display = 'none';
  card.append(approve, reject, retry); parent.appendChild(card); approval.card = card;
  function owns() { return aiApproval === approval && generation === aiChatGeneration && aiOwnsSession(sessionGeneration, sessionToken); }
  function update() {
    if (!owns()) return;
    if (!approval.decision && Date.now() >= approval.expiresAt) {
      approval.finished = true; status.textContent = 'Approval expired. This action was not approved.'; clearInterval(approval.timer); aiApproval = null;
    }
    approve.disabled = approval.busy || !!approval.decision || approval.finished; reject.disabled = approval.busy || !!approval.decision || approval.finished;
    retry.hidden = !approval.decision || approval.finished; retry.style.display = retry.hidden ? 'none' : '';
    retry.disabled = approval.busy || !approval.decision || approval.finished; aiUpdateControls();
  }
  async function decide(decision) {
    if (!owns() || approval.busy || approval.finished || (decision !== 'approve' && decision !== 'reject')) return;
    if (!approval.decision && Date.now() >= approval.expiresAt) { update(); return; }
    if (approval.decision && approval.decision !== decision) return;
    approval.decision = decision; approval.busy = true;
    var controller = aiController(); approval.controller = controller;
    status.textContent = decision === 'approve' ? 'Approval submitted. Waiting for its receipt...' : 'Rejection submitted. Waiting for its receipt...'; update();
    try {
      var receipt = await aiRequestJSON('/ai/approvals/' + encodeURIComponent(approval.id), { method: 'POST', body: JSON.stringify({ decision: decision }) }, controller, sessionToken);
      if (!owns()) return;
      if (!receipt || receipt.approvalId !== approval.id || receipt.name !== approval.name
        || ['completed','rejected','failed','executing'].indexOf(receipt.status) === -1) throw new Error('Invalid approval receipt.');
      if (receipt.status === 'executing') {
        status.textContent = 'Action is executing. Check this same action receipt; do not submit another approval.'; retry.textContent = 'Check action status';
      } else {
        approval.finished = true;
        status.textContent = receipt.status === 'completed' ? 'Action completed.' : receipt.status === 'rejected' ? 'Action rejected. It was not executed.' : 'Action failed. Review the receipt and Audit Log before requesting another action.';
        if (receipt.result !== undefined || receipt.error) {
          var result = document.createElement('pre'); result.style.whiteSpace = 'pre-wrap'; result.style.overflowWrap = 'anywhere';
          result.textContent = receipt.error || JSON.stringify(receipt.result, null, 2); card.appendChild(result);
        }
        clearInterval(approval.timer);
      }
    } catch (error) {
      if (!owns()) return;
      if (error.status === 404 || error.status === 410 || error.status === 400) {
        approval.finished = true; clearInterval(approval.timer); status.textContent = 'Approval or receipt is unavailable. Check Audit Log before requesting this action again.';
      } else {
        status.textContent = 'Outcome not confirmed. Retry this same action receipt; do not request a replacement action.'; retry.textContent = 'Retry same action receipt';
      }
    } finally {
      aiControllers.delete(controller);
      if (owns()) {
        approval.busy = false; approval.controller = null; update();
        if (approval.finished) { aiApproval = null; aiUpdateControls(); }
      }
    }
  }
  approve.addEventListener('click', function() { decide('approve'); }); reject.addEventListener('click', function() { decide('reject'); });
  retry.addEventListener('click', function() { decide(approval.decision); }); approval.timer = setInterval(update, 1000); update();
}

async function runAiChat() {
  var generation = ++aiChatGeneration; var sessionGeneration = aiSessionGeneration; var sessionToken = token;
  var controller = aiController(); aiChatController = controller;
  var msg = appendAiMessage('assistant', ''); var text = msg.querySelector('.ai-text'); var fullText = ''; var terminal = ''; var reader;
  aiStreaming = true; aiUpdateControls();
  function owns() { return generation === aiChatGeneration && aiOwnsSession(sessionGeneration, sessionToken); }
  var timer = setTimeout(function() { controller.abort(); }, 130000);
  try {
    var response = await fetch(BASE + '/admin/api/ai/chat', { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sessionToken }, signal: controller.signal,
      body: JSON.stringify({ messages: aiMessages, provider: document.getElementById('aiProviderSelect').value, model: document.getElementById('aiModelSelect').value }),
    });
    if (!owns()) return;
    if (!response.ok) {
      var body = await aiReadJSON(response); if (response.status === 401 && owns()) logout();
      throw new Error(body && typeof body.error === 'string' ? body.error : 'AI request failed.');
    }
    if (!response.body || !/^text\/event-stream(?:;|$)/i.test(response.headers.get('Content-Type') || '')) throw new Error('Invalid AI stream response.');
    reader = response.body.getReader();
    var parser = createAdminAiSseParser(function(event) {
      if (!owns()) return;
      if (event.type === 'text') { fullText += event.text; text.innerHTML = formatAiText(fullText); }
      else if (event.type === 'tool_call') aiNotice(msg, 'Proposed tool: ' + event.name, false);
      else if (event.type === 'tool_result') aiNotice(msg, 'Tool result: ' + event.name + (event.result !== undefined ? '\n' + JSON.stringify(event.result, null, 2) : ''), false);
      else if (event.type === 'tool_error') aiNotice(msg, 'Tool failed: ' + event.name + ' — ' + event.error, true);
      else if (event.type === 'error') { terminal = 'error'; aiNotice(msg, event.error, true); aiSetStatus('AI response failed. No automatic retry was sent.'); }
      else if (event.type === 'done') terminal = 'done';
      else if (event.type === 'confirmation_required') { terminal = 'confirmation_required'; showAiApproval(event, msg, generation, sessionGeneration, sessionToken); }
      document.getElementById('aiChatArea').scrollTop = document.getElementById('aiChatArea').scrollHeight;
    });
    while (owns()) {
      var chunk = await reader.read(); if (!owns()) return;
      if (chunk.done) { parser.finish(); break; }
      if (parser.push(chunk.value)) { parser.finish(); await reader.cancel(); break; }
    }
    if (owns() && terminal !== 'error' && fullText) {
      var history = aiMessages.concat([{ role: 'assistant', content: fullText }]);
      if (aiHistoryFits(history)) aiMessages = history;
      else { aiHistoryBlocked = true; aiSetStatus('The response is too large to include in another request. It remains visible; clear the conversation before sending again.'); }
    }
  } catch (error) {
    if (owns()) {
      if (aiApproval && aiApproval.generation === generation) {
        clearInterval(aiApproval.timer); aiApproval.card.remove(); aiApproval = null;
      }
      aiNotice(msg, controller.signal.aborted ? 'AI request timed out. No automatic retry was sent.' : error.message, true);
      aiSetStatus('AI response interrupted. Partial text is visible but was not added to conversation history.');
    }
  } finally {
    clearTimeout(timer); aiControllers.delete(controller);
    if (reader) { await reader.cancel().catch(function() {}); reader.releaseLock(); }
    if (owns()) { aiStreaming = false; aiChatController = null; aiUpdateControls(); }
  }
}
function formatAiText(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\u0060([^\u0060]+)\u0060/g, '<code>$1</code>');
}

document.getElementById('aiSendBtn').addEventListener('click', sendAiMessage);
document.getElementById('aiInput').addEventListener('keydown', function(event) { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendAiMessage(); } });
document.getElementById('aiClearBtn').addEventListener('click', function() { clearAiChat(false); });
document.getElementById('aiProviderSelect').addEventListener('change', updateAiModels);
document.getElementById('aiReloadBtn').addEventListener('click', function() { aiSettingsLoaded = false; refreshAiProviders(); });
document.getElementById('aiSettingsToggle').addEventListener('click', function() {
  var panel = document.getElementById('aiSettingsPanel'); panel.style.display = panel.style.display === 'none' ? '' : 'none'; loadAiSettings();
});
document.getElementById('aiSettingsSave').addEventListener('click', saveAiSettings);
['aiLocalEndpoint','aiLocalApiKey','aiLocalModel','aiCustomPrompt','aiTemperature'].forEach(function(id) {
  document.getElementById(id).addEventListener('input', function() { aiSettingsRevision++; aiSettingsDirty = true; });
});
`;
}

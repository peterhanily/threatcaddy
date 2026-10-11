/** Shared generated browser source, separately executable in parser regressions. */
export function aiStreamJs(): string {
  return String.raw`
function validateAdminAiEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
    throw new Error('Invalid AI stream event.');
  }
  function string(value) { return typeof value === 'string'; }
  function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  var valid = false;
  switch (event.type) {
    case 'provider': valid = string(event.provider) && string(event.model); break;
    case 'text': valid = string(event.text); break;
    case 'tool_call': valid = string(event.name) && object(event.input); break;
    case 'tool_result': valid = string(event.name); break;
    case 'tool_error': valid = string(event.name) && string(event.error); break;
    case 'error': valid = string(event.error); break;
    case 'done': valid = event.stopReason === undefined || string(event.stopReason); break;
    case 'confirmation_required':
      valid = string(event.approvalId) && event.approvalId.length > 0 && event.approvalId.length <= 200
        && string(event.name) && event.name.length > 0 && event.name.length <= 200 && object(event.input)
        && Number.isSafeInteger(event.expiresAt) && event.expiresAt > 0 && event.expiresAt <= 8640000000000000;
      break;
  }
  if (!valid) throw new Error('Invalid or unsupported AI stream event.');
  return event;
}

function createAdminAiSseParser(onEvent) {
  var decoder = new TextDecoder('utf-8', { fatal: true });
  var encoder = new TextEncoder();
  var buffer = '';
  var data = [];
  var recordBytes = 0;
  var totalBytes = 0;
  var terminal = false;
  var ended = false;
  var eventLimit = 256 * 1024;
  var streamLimit = 1024 * 1024;

  function line(value) {
    if (value === '') {
      if (data.length) {
        if (terminal) throw new Error('AI stream continued after completion.');
        var event;
        try { event = validateAdminAiEvent(JSON.parse(data.join('\n'))); }
        catch (error) { throw new Error('Malformed AI stream event.'); }
        terminal = event.type === 'done' || event.type === 'error' || event.type === 'confirmation_required';
        onEvent(event);
      }
      data = [];
      recordBytes = 0;
      return;
    }
    recordBytes += encoder.encode(value).byteLength + 1;
    if (recordBytes > eventLimit) throw new Error('AI stream event exceeds the size limit.');
    if (value.charAt(0) === ':') return;
    var colon = value.indexOf(':');
    var field = colon === -1 ? value : value.slice(0, colon);
    var contents = colon === -1 ? '' : value.slice(colon + 1);
    if (contents.charAt(0) === ' ') contents = contents.slice(1);
    if (field === 'data') data.push(contents);
  }

  function consume(final) {
    var start = 0;
    for (var i = 0; i < buffer.length; i++) {
      var char = buffer.charAt(i);
      if (char !== '\n' && char !== '\r') continue;
      if (char === '\r' && i + 1 === buffer.length && !final) break;
      line(buffer.slice(start, i));
      if (char === '\r' && buffer.charAt(i + 1) === '\n') i++;
      start = i + 1;
    }
    buffer = buffer.slice(start);
    if (recordBytes + encoder.encode(buffer).byteLength > eventLimit) throw new Error('AI stream event exceeds the size limit.');
  }

  return {
    push: function(chunk) {
      if (ended) throw new Error('AI stream is already closed.');
      totalBytes += chunk.byteLength;
      if (totalBytes > streamLimit) throw new Error('AI stream exceeds the size limit.');
      buffer += decoder.decode(chunk, { stream: true });
      consume(false);
      return terminal;
    },
    finish: function() {
      if (ended) throw new Error('AI stream is already closed.');
      ended = true;
      buffer += decoder.decode();
      consume(true);
      if (buffer || data.length || !terminal) throw new Error('AI response ended before a complete terminal event.');
    },
    isTerminal: function() { return terminal; }
  };
}
`;
}

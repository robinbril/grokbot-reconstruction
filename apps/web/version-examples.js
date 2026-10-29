// Own, explicitly opened fixtures. These are not exported Grok conversations.
export function openVersionExamples(state) {
  const parentBotId = 'local-version-0712';
  if (!state.agents.some(agent => agent.id === parentBotId)) {
    state.agents.push({ id: parentBotId, name: '0.71.2 voorbeelden', preview: 'Lokale voorbeelden van taakgesprekken', color: '#35b6cd', shape: 0 });
  }
  state.tasks ||= [];
  for (const [suffix, name, text] of [
    ['a', 'Onderzoek voorbereiden', 'Dit lokale taakvoorbeeld gaat over de voorbereiding van onderzoek.'],
    ['b', 'Resultaten controleren', 'Dit lokale taakvoorbeeld gaat over het controleren van resultaten.'],
  ]) {
    const id = `local-task-0712-${suffix}`, conversationId = `local-thread-0712-${suffix}`;
    if (!state.tasks.some(task => task.id === id && task.parentBotId === parentBotId)) {
      state.tasks.push({ id, conversationId, parentBotId, name, status: 'open' });
    }
    state.messages[conversationId] ||= [{ id: `local-message-0712-${suffix}`, role: 'bot', localExample: true, text }];
  }
  state.messages[parentBotId] ||= [{ id: 'local-message-0712-parent', role: 'bot', localExample: true,
    text: 'Deze lokale 0.71.2 voorbeelden tonen afzonderlijke taakgesprekken en vastgemaakte taken. Alle berichten en keuzes blijven in deze browser.' }];
  state.selected = parentBotId;
  state.context = false;
}

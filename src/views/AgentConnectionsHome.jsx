import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { apiRequest } from '../data/api.js';
import { frondoseActions } from '../data/useFrondose.js';
import { Button, ErrorMessage, PageHeader, SearchField, useApp, useAsync } from '../ui.jsx';
import { ArrowLeft, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Plus } from '../components/icons.jsx';
import { AgentIdentity } from '../components/AgentIdentity.jsx';
import { ConnectionActionMenu } from '../components/ConnectionActionMenu.jsx';
import { ProviderProductPreview } from '../components/ProviderProductPreview.jsx';
import { SlidingTabs } from '../components/SlidingTabs.jsx';
import { AGENT_CONNECTION_CATALOG, FEATURED_AGENT_CONNECTIONS, agentConnectionById, connectedAgentIdentities,
  identityConnectionReadiness, methodBinding, providerAccountReady, searchAgentConnections, workspaceAgentIdentities } from '../lib/agent-connections-catalog.js';
import { val } from '../lib/model.js';
import './agent-connections-home.css';

const GROUPS = [{ id: 'code', title: 'Coding agents' }, { id: 'models', title: 'Models & API providers' }];
const galleryOptions = FEATURED_AGENT_CONNECTIONS.map(item => ({ value: item.id, label: agentConnectionById(item.id).name }));
const detailId = provider => `connection-${provider}`;

export function AgentConnectionsHome() {
  const { data, workspace, page, navigate, edit } = useApp();
  const [query, setQuery] = useState(''), [category, setCategory] = useState('all'), [feature, setFeature] = useState('codex');
  const [connectionMetadata, setConnectionMetadata] = useState(null), [metadataError, setMetadataError] = useState(null);
  const chatAction = useAsync();
  const providerId = page.id?.startsWith('connection-') ? page.id.slice('connection-'.length) : null;
  const provider = providerId ? agentConnectionById(providerId) : null;
  const surfaceRef = useRef(null);
  useLayoutEffect(() => { surfaceRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); }, [providerId]);
  const connected = connectedAgentIdentities(data, workspace.id);
  const identities = workspaceAgentIdentities(data, workspace.id);
  const matching = useMemo(() => searchAgentConnections(query, category), [query, category]);
  const featured = FEATURED_AGENT_CONNECTIONS.find(item => item.id === feature) || FEATURED_AGENT_CONNECTIONS[0];
  useEffect(() => {
    let active = true; setConnectionMetadata(null); setMetadataError(null);
    apiRequest(`/api/ai-connections?workspace_id=${encodeURIComponent(workspace.id)}`)
      .then(response => { if (active) setConnectionMetadata(response.result); })
      .catch(cause => { if (active) setMetadataError(cause); });
    return () => { active = false; };
  }, [workspace.id]);

  function configure(item, identityKind, methodId) {
    edit('agent', null, { provider: item.id, identity_kind: identityKind, connection_method: methodId,
      lock_provider: true, lock_identity_kind: true,
      provider_connection_id: methodBinding(item.id, methodId, data, workspace.id, connectionMetadata) });
  }
  function openChat(agent) {
    return chatAction.execute(async () => {
      const existing = (data.chats || []).filter(chat => !val(chat, 'archived_at') && val(chat, 'workspace_id') === workspace.id && val(chat, 'responding_agent_id') === agent.id && !val(chat, 'project_id') && !val(chat, 'task_id'))
        .sort((a, b) => String(val(b, 'updated_at')).localeCompare(String(val(a, 'updated_at'))))[0];
      const chat = existing || await frondoseActions.createChat({ workspace_id: workspace.id, title: `Chat with ${agent.name}`, participant_agent_ids: [agent.id] });
      navigate('chats', chat.id);
    });
  }

  if (providerId && !provider) return <main className="page agent-connections-home"><PageHeader title="Connection unavailable" /><p>This connection is not in the current catalog.</p><Button onClick={() => navigate('agents')}>Your Agents</Button></main>;
  if (provider) {
    const ownIdentities = identities.filter(item => item.provider === provider.id), ready = ownIdentities.filter(item => identityConnectionReadiness(item, data, workspace.id).canStartLive);
    const direct = ready.filter(item => item.identity_kind === 'provider');
    const accountReady = providerAccountReady(provider.id, data, workspace.id);
    return <main ref={surfaceRef} className="page agent-connections-home provider-library-detail">
      <button className="provider-library-back" type="button" onClick={() => navigate('agents')}><ArrowLeft />Your Agents</button>
      <header className="provider-library-header"><AgentIdentity provider={provider.id} /><div><h1>{provider.name}</h1><p>{provider.description}</p></div></header>
      <div className="provider-library-actions">
        <ConnectionActionMenu label={`Connect ${provider.name}`} methods={provider.methods} primary onChoose={method => configure(provider, 'provider', method)} />
        <ConnectionActionMenu label="Create Agent Connection" methods={provider.methods} onChoose={method => configure(provider, 'agent', method)} />
      </div>
      <ErrorMessage error={metadataError || chatAction.error} />
      <section className="provider-library-panel">
        <dl className="provider-library-facts"><div><dt>Connection methods</dt><dd>{provider.methods.map(method => method.label).join(' · ')}</dd></div><div><dt>Account</dt><dd>{ready.length ? 'Connected identities available' : accountReady ? 'Account connected' : 'Setup required'}</dd></div><div><dt>Website</dt><dd>{provider.docs ? <a href={provider.docs} target="_blank" rel="noreferrer">{new URL(provider.docs).hostname}<ArrowUpRight /></a> : 'See computer setup'}</dd></div></dl>
        <div className="provider-library-previews">
          {provider.featured ? <figure className="provider-product-preview provider-generated-preview"><img src={provider.featured.image} alt={`Illustrative ${provider.name} product presentation`} /><figcaption>Illustrative preview · not a live session</figcaption></figure> : <ProviderProductPreview provider={provider} />}
          <ProviderProductPreview provider={provider} kind="context" />
        </div>
        <div className="provider-library-copy">
          <h2>Overview</h2><p>{provider.description} Keep the conversation and the context you choose together in Frondose.</p>
          <h2>Two ways to use {provider.name}</h2>
          <p><strong>Connect {provider.name}</strong> adds a direct provider identity with its provider name. Choose that identity in a conversation, or use its explicit @ shortcut. A conversation keeps one responding identity.</p>
          <p><strong>Create Agent Connection</strong> gives it your own name and Personalization. Multiple agents can use the same provider account without merging their conversation histories.</p>
          <h2>Connect your account</h2><p>{provider.api ? 'Use your own API credentials, or browser authorization where it is supported. Choose a chat model before sending. Provider charges and limits remain with your account.' : provider.id === 'copilot' ? 'Use supported GitHub authorization or a separately configured computer connection. Each person needs their own eligible provider access.' : 'Sign in through the provider’s own CLI. For a computer connection, pair your computer, authorize the runtime locally, then bind this identity to it. The helper and computer must stay online.'}</p>
          <Button onClick={() => navigate('connections', provider.api || ['codex', 'claude', 'copilot'].includes(provider.id) ? provider.id : null)}>Account & computer settings<ArrowRight /></Button>
          <h2>Your conversations stay in Frondose</h2><p>CLI chat-history import and synchronization are not part of this connection. Reading this page, creating an identity and mentioning a provider never start a model request. You choose when to send.</p>
          {ownIdentities.length ? <><h2>Your {provider.name} identities</h2><div className="provider-identity-list">{ownIdentities.map(agent => <button type="button" key={agent.id} onClick={() => navigate('agents', agent.id)}><AgentIdentity agent={agent} compact /><span>{agent.name}</span><small>{identityConnectionReadiness(agent, data, workspace.id).label}</small><ArrowRight /></button>)}</div></> : null}
          {direct.length ? <div className="provider-direct-chats">{direct.map(agent => <Button key={agent.id} busy={chatAction.busy} onClick={() => openChat(agent)}>Chat with {agent.name}<ArrowRight /></Button>)}</div> : null}
        </div>
      </section>
    </main>;
  }

  return <main ref={surfaceRef} className="page agent-connections-home">
    <PageHeader title="Your Agents"><Button onClick={() => navigate('agents', 'manage')}>Manage agents</Button><Button variant="primary" icon={Plus} onClick={() => edit('agent')}>New agent</Button></PageHeader>
    <SearchField label="Search Agent Connections" placeholder="Search Agent Connections…" value={query} onChange={setQuery} />
    <section className="connected-agent-library" aria-labelledby="connected-agents-title"><h2 id="connected-agents-title">Connected</h2>
      {connected.length ? <div className="connected-agent-grid">{connected.filter(agent => `${agent.name} ${agent.provider}`.toLowerCase().includes(query.toLowerCase())).map(agent => <button type="button" className="connected-agent-tile" key={agent.id} onClick={() => navigate('agents', agent.id)}><AgentIdentity agent={agent} /><span><strong>{agent.name}</strong><small>{agent.identity_kind === 'provider' ? 'Direct provider' : 'Personalized agent'} · Connected</small></span><ArrowRight /></button>)}</div> : <p>No connected agents yet. Choose a connection below to get started.</p>}
      {identities.length > connected.length ? <button type="button" className="text-button" onClick={() => navigate('agents', 'manage')}>{identities.length - connected.length} {identities.length - connected.length === 1 ? 'identity needs' : 'identities need'} setup or is paused<ArrowRight /></button> : null}
    </section>
    {!query.trim() ? <section className="agent-feature-gallery" aria-label="Featured agent connections">
      <button className="agent-feature-stage" type="button" onClick={() => navigate('agents', detailId(featured.id))}>
        <img key={featured.id} src={featured.image} alt={`Illustrative ${agentConnectionById(featured.id).name} product presentation`} />
        <span className="agent-feature-caption"><AgentIdentity provider={featured.id} /><span><strong>{agentConnectionById(featured.id).name}</strong><span>{featured.headline}</span></span><ArrowUpRight /></span>
      </button>
      <div className="agent-feature-controls"><SlidingTabs value={feature} onChange={setFeature} options={galleryOptions} label="Featured connections" /><div><button type="button" className="icon-button" aria-label="Previous featured connection" onClick={() => setFeature(FEATURED_AGENT_CONNECTIONS[(FEATURED_AGENT_CONNECTIONS.findIndex(item => item.id === feature) + 2) % 3].id)}><ChevronLeft /></button><button type="button" className="icon-button" aria-label="Next featured connection" onClick={() => setFeature(FEATURED_AGENT_CONNECTIONS[(FEATURED_AGENT_CONNECTIONS.findIndex(item => item.id === feature) + 1) % 3].id)}><ChevronRight /></button></div></div>
    </section> : null}
    <section className="agent-connection-library" aria-label="Agent connection catalog"><SlidingTabs value={category} onChange={setCategory} options={[{value:'all',label:'All connections'},...GROUPS.map(group=>({value:group.id,label:group.title}))]} label="Connection categories" />
      {GROUPS.map(group => {
        const providers = matching.filter(item => item.group === group.id);
        return providers.length ? <section className="agent-connection-group" key={group.id} aria-labelledby={`agent-group-${group.id}`}><h2 id={`agent-group-${group.id}`}>{group.title}</h2><div className="agent-connection-grid">{providers.map(item => <button className="agent-connection-card" type="button" key={item.id} onClick={() => navigate('agents', detailId(item.id))}><span className="agent-connection-card-title"><AgentIdentity provider={item.id} /><strong>{item.name}</strong><ArrowUpRight /></span><p>{item.description}</p><span className="agent-connection-card-methods">{item.methods.map(method => method.label).join(' · ')}</span>{providerAccountReady(item.id, data, workspace.id) ? <span className="agent-connection-connected">Account connected</span> : null}</button>)}</div></section> : null;
      })}
      {!matching.length ? <div className="agent-library-empty"><h2>No matching connections</h2><p>Try a provider name, API key or computer connection.</p><Button onClick={() => { setQuery(''); setCategory('all'); }}>Clear filters</Button></div> : null}
    </section>
  </main>;
}

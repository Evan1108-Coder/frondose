import { useState } from "react";
import { ArrowRight, Check, RotateCcw } from "../components/icons.jsx";
import { Button, Empty, IconButton, PageHeader, SearchField, Select, Status, useApp } from "../ui.jsx";
import { focusItems } from "../lib/organization.js";
import { visible } from "../lib/model.js";

export function FocusView() {
  const { data, organization, updateOrganization, navigate, startSession, notify } = useApp();
  const [query, setQuery] = useState(""), [project, setProject] = useState("all"), [filter, setFilter] = useState("all");
  const items = focusItems(data, organization.seenFailures);
  const filtered = items.filter(item => (project === "all" || item.projectId === project) && (filter === "all" || item.group === filter) && `${item.title} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));
  const groups = [["attention", "Needs your attention", "Decisions and blockers come first."], ["running", "In motion", "Work currently queued or running."], ["ready", "Up next", "Routes ready for their next step."]];
  const save = value => { try { updateOrganization(value); } catch (error) { notify(error.message, "error"); } };
  return <main className="page focus-page"><PageHeader title="Focus" description="One place to see what needs a decision, what’s running, and what’s next."><Button variant="primary" onClick={() => startSession()}>Start session</Button></PageHeader>
    <div className="focus-summary">{groups.map(([id, title]) => <button key={id} aria-pressed={filter === id} onClick={() => setFilter(filter === id ? "all" : id)}><strong>{items.filter(item => item.group === id).length}</strong><span>{title}</span></button>)}</div>
    <div className="focus-toolbar"><SearchField value={query} onChange={setQuery} placeholder="Find work…" /><Select aria-label="Focus project" value={project} onChange={setProject}><option value="all">All projects</option>{visible(data.projects).map(p => <option value={p.id} key={p.id}>{p.name}</option>)}</Select>{filter !== "all" || query || project !== "all" ? <Button onClick={() => { setFilter("all"); setQuery(""); setProject("all"); }}>Clear filters</Button> : null}</div>
    {filtered.length ? groups.map(([id, title, description]) => { const entries = filtered.filter(item => item.group === id); return entries.length ? <section className="focus-group" key={id}><header><h2>{title}</h2><p>{description}</p></header><div className="focus-list">{entries.map(item => <div className="focus-row" key={item.key}><button onClick={() => navigate(item.view, item.id)}><span><strong>{item.title}</strong><small>{item.detail}{item.projectId ? ` · ${data.projects.find(p => p.id === item.projectId)?.name ?? "Project"}` : ""}</small></span><Status value={item.status} /><ArrowRight /></button>{item.dismissible ? <IconButton label={`Mark ${item.title} seen`} onClick={() => save({ ...organization, seenFailures: [...organization.seenFailures, item.id] })}><Check /></IconButton> : null}</div>)}</div></section> : null; }) : <Empty compact kind="focus" title={items.length ? "No matching work" : "You’re clear for now"} description={items.length ? "Try another project or clear the filters." : "Approvals, blocked routes, active sessions, and ready routes will appear here. Nothing runs automatically."} action={items.length ? "Clear filters" : "Explore routes"} onAction={() => items.length ? (setFilter("all"), setQuery(""), setProject("all")) : navigate("tasks")} />}
    {organization.seenFailures.length ? <Button variant="ghost" icon={RotateCcw} onClick={() => save({ ...organization, seenFailures: [] })}>Show previously seen failures</Button> : null}
  </main>;
}

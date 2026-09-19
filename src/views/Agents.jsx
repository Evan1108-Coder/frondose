import { useState } from "react";
import { Plus, Archive, BookOpen, ArrowRight, ArrowLeft } from "../components/icons.jsx";
import { Button, Empty, PageHeader, SearchField, Select, useApp } from "../ui.jsx";
import { relative, val, visible } from "../lib/model.js";

export function MemoryView() {
  const { data, page, edit, archive, navigate } = useApp();
  const [query, setQuery] = useState(""),
    [workspaceOnly, setWorkspaceOnly] = useState(false);
  const project = visible(data.projects).find(
    (item) => item.id === page.projectId,
  );
  const createMemory = () => edit("memory", null, project ? { project_id: project.id } : {});
  if (page.projectId && !project) return (
    <main className="page">
      <Empty kind="projects" title="Project unavailable"
        description="This project may be archived or belong to another workspace. Choose an available project to see its saved context."
        action="All projects" onAction={() => navigate("projects")}
        secondaryAction="All memory" onSecondaryAction={() => navigate("memory")} />
    </main>
  );
  const notes = visible(data.memory_notes).filter(
    (note) =>
      `${note.title} ${note.content}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (project ? val(note, "project_id") === project.id : !workspaceOnly || !val(note, "project_id")),
  );
  const isBlank = !notes.length && !query && !workspaceOnly;
  return (
    <main className="page">
      {!isBlank ? <>
      {project ? <button className="back-link" onClick={() => navigate("projects", project.id)}><ArrowLeft />{project.name}</button> : null}
      <PageHeader
        title="Memory"
        description={project ? `Decisions, conventions, and context for ${project.name}.` : "Keep decisions, conventions, and useful context close to the work."}
      >
        <Button variant="primary" icon={Plus} onClick={createMemory}>
          Add memory
        </Button>
      </PageHeader>
      <div className="toolbar">
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search memory…"
        />
        <Select
          value={page.projectId ?? (workspaceOnly ? "workspace" : "all")}
          onChange={(value) => {
            setWorkspaceOnly(value === "workspace");
            navigate("memory", null, { projectId: ["all", "workspace"].includes(value) ? null : value });
          }}
          aria-label="Filter memory by project"
        >
          <option value="all">All context</option>
          {!project ? <option value="workspace">Workspace memory</option> : null}
          {visible(data.projects).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        <span className="toolbar-count">{notes.length} notes</span>
      </div>
      </> : null}
      {notes.length ? (
        <div className="memory-grid">
          {notes.map((note) => (
            <article className="memory-card" key={note.id}>
              <div className="memory-card-heading">
                <BookOpen />
                <span>
                  {data.projects.find(
                    (item) => item.id === val(note, "project_id"),
                  )?.name ?? "Workspace"}
                </span>
                <time>{relative(val(note, "updated_at"))}</time>
              </div>
              <button
                className="memory-content"
                onClick={() => edit("memory", note)}
              >
                <h2>{note.title}</h2>
                <p>{note.content}</p>
              </button>
              <div className="memory-actions">
                <button
                  className="text-button"
                  onClick={() => edit("memory", note)}
                >
                  Edit note <ArrowRight />
                </button>
                <button
                  className="text-button"
                  onClick={() => archive("memory", note)}
                >
                  <Archive />
                  Archive
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          kind={query ? "search" : "memory"}
          actionVariant={isBlank ? "primary" : "secondary"}
          icon={BookOpen}
          title={
            query ? "No matching notes" : project ? "A shared memory for this project" : "Less repeating. More remembering."
          }
          description={query ? "Try another search to find the decisions and details you saved." : "Save the decisions and details agents should know. Choose which notes to include before starting a session."}
          action={query ? "Clear search" : "Add memory"}
          onAction={query ? () => setQuery("") : createMemory}
          secondaryAction={project ? "Open project" : undefined}
          onSecondaryAction={project ? () => navigate("projects", project.id) : undefined}
        />
      )}
    </main>
  );
}

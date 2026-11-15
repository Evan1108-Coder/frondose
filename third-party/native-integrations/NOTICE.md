# Native integration catalog and brand marks

The seven-provider grouping and Open in Apps preset selection were inspected
against Orca revision 51dcef8258230ffea85a907130450b0ad676e22b (MIT); its notice
remains in ../orca/NOTICE.md. Frondose's bounded API clients, OS-secret storage,
resource selection and native application launch bridge are independent code.
No Orca cloud identity, token, publisher feed or OAuth registration is reused.

Gitea's mark is from Simple Icons (CC0-1.0), icons/gitea.svg on develop,
retrieved 2026-10-27. Azure DevOps' mark is from Simple Icons 9.21.0,
icons/azuredevops.svg (CC0-1.0). Brand/trademark rights remain with their owners.
Bitbucket uses the existing SVG Logos package and its preserved notices.

Official API references: docs.github.com/rest; docs.gitlab.com/api;
developer.atlassian.com/cloud/bitbucket/rest; learn.microsoft.com/rest/api/azure/devops;
docs.gitea.com/api; linear.app/developers/graphql;
developer.atlassian.com/cloud/jira/platform/rest/v3.

These connections currently provide explicit bounded reads only. No background
sync, issue creation, comments, merging, pushes or other remote writes are offered.

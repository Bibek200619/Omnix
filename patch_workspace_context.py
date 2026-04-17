import re

with open('frontend/lib/workspace-context.tsx', 'r') as f:
    content = f.read()

content = content.replace(
    'const data = await apiClient.get<Workspace[]>("/workspaces");',
    'const data = await apiClient.get<Workspace[]>("/workspaces/hierarchy");'
)

with open('frontend/lib/workspace-context.tsx', 'w') as f:
    f.write(content)

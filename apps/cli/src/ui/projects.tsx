/**
 * The project list as an aligned table.
 *
 * Ids are fixed width and names are not, so the columns are measured before
 * anything is drawn -- a list that does not line up is harder to read than one
 * with no colour at all.
 */
import { Box, Text, render } from 'ink'

export type ProjectRow = { id: string; name: string; targetUrl: string }

function Projects({ projects }: { projects: ProjectRow[] }) {
  const idWidth = Math.max(...projects.map((p) => p.id.length))
  const nameWidth = Math.max(...projects.map((p) => p.name.length))

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor bold>
          {'ID'.padEnd(idWidth)}
        </Text>
        <Text dimColor bold>
          {'  '}
          {'NAME'.padEnd(nameWidth)}
        </Text>
        <Text dimColor bold>
          {'  '}TARGET
        </Text>
      </Box>
      {projects.map((project) => (
        <Box key={project.id}>
          <Text color="cyan">{project.id.padEnd(idWidth)}</Text>
          <Text bold>
            {'  '}
            {project.name.padEnd(nameWidth)}
          </Text>
          <Text dimColor>
            {'  '}
            {project.targetUrl}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

/** Renders once and returns; there is nothing live about a list. */
export function renderProjects(projects: ProjectRow[]): void {
  render(<Projects projects={projects} />).unmount()
}

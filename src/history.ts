export interface Interaction {
  id: string
  question: string
  answer: string
  createdAt: number
}

export interface History {
  entries: Interaction[]
}

export function searchHistory(entries: readonly Interaction[], query: string) {
  const needle = query.trim().toLocaleLowerCase()
  const result: Interaction[] = []
  for (const entry of entries) {
    const text = `${entry.question}\n${entry.answer}`.toLocaleLowerCase()
    if (needle && !text.includes(needle)) continue
    result.push(entry)
  }
  result.sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
  return result
}

export function dateGroup(timestamp: number) {
  const date = new Date(timestamp).toDateString()
  if (date === new Date().toDateString()) return "Today"
  return date
}

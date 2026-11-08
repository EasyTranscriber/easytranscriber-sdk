// Deliberately long, Unicode-rich, formula-looking fixture text. Never sent externally.
export const configuration = {
  video_url: 'https://www.youtube.com/watch?v=fixture1234',
  summary_language: 'English',
  destination: 'notion',
  run_key: 'offline-smoke',
  notion_parent_page_id: '11111111-1111-4111-8111-111111111111',
  sheets_spreadsheet_id: 'offline-spreadsheet',
  sheets_tab: "Researcher's notes",
};
export const transcript = {
  video_id: 'fixture1234', video_title: 'Offline fixture: 中文 and surrogate pairs',
  transcript: '=SUM(1,2)\n' + ('Caption text 中文 \u{1F642}\n\t"quoted" \\ literal.\n'.repeat(13000)),
  method: 'innertube', cached: false, credits_used: 2,
};
export const summary = {
  summary: '## Offline summary\n' + ('Summary 中文 \u{1F642}\n'.repeat(3200)),
  video_id: transcript.video_id, credits_used: 1,
};
export const metadata = {
  run_key: configuration.run_key, video_url: configuration.video_url,
  video_id: transcript.video_id, video_title: transcript.video_title,
  method: transcript.method, cached: transcript.cached,
  transcript_credits_used: transcript.credits_used, summary_credits_used: summary.credits_used,
  total_credits_used: 3, summary_video_id: summary.video_id,
  summary_language: configuration.summary_language,
};

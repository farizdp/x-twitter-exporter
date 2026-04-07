# X Exporter v5

Export your Twitter/X **Likes** and **Bookmarks** as JSON.

## Usage

### Option 1: Console Script

1. Go to `x.com/[username]/likes` or `x.com/i/bookmarks`
2. Open DevTools (F12 or Cmd+Opt+I)
3. Paste the contents of `twitter_likes_exporter_v5.js` into the Console and press Enter

### Option 2: Browser Extension

1. Open your browser's extension management page
2. Enable "Developer mode"
3. Load `x-exporter.zip` as an unpacked extension (extract first if needed)
4. Navigate to your Likes or Bookmarks page

## How It Works

A floating widget appears in the bottom-right corner of the page with these controls:

- **Start/Stop** — begins auto-scrolling the page to load tweets
- **Reset** — clears all collected data
- **JSON** — downloads the collected tweets as a JSON file

The script captures tweet data through two methods:
1. **GraphQL interception** — intercepts Twitter's API responses for accurate, structured data
2. **DOM scraping** — reads rendered tweet elements as a fallback

Auto-scrolling stops automatically after the page stops loading new content (20 consecutive stall checks).

## Exported Fields

| Field | Description |
|---|---|
| `id` | Tweet ID |
| `user_name` | Display name |
| `user_screen_name` | @handle |
| `full_text` | Tweet text (t.co links expanded) |
| `url` | Permalink to the tweet |
| `media_url` | Attached image URLs |
| `media_type` | `photo`, `video`, or `animated_gif` |
| `media_count` | Number of media attachments |
| `created_at` | Tweet timestamp |

## Output Files

Downloads are named automatically:
- Likes: `x-[username]-likes-[YYYYMMDD].json`
- Bookmarks: `x-bookmarks-[YYYYMMDD].json`

## Viewer

Open `viewer.html` in any browser to browse your exported tweets.

### Features

- **Timeline view** — scrollable feed of tweet cards, similar to Twitter's layout
- **Categories** — tag tweets manually or auto-categorize with an LLM (any OpenAI-compatible API)
- **Category colors** — assign custom colors to each category via a color picker in the sidebar
- **Inline category editing** — rename or delete categories directly from the sidebar on hover
- **Open in X** — pill button on each tweet card to open the original tweet in a new tab
- **Detail panel** — click a tweet to see its Twitter oEmbed preview and raw field data; panel width is resizable by dragging its left edge
- **Search & filter** — search by text/user, filter by category
- **Theme toggle** — dark and light themes
- **Export/Import categories** — save your categorization work as JSON and reload it later

### How to use

1. Export your tweets using the console script or browser extension
2. Open `viewer.html` in your browser
3. Click **Load File** or drag-and-drop your `.json` export
4. Browse, categorize, and explore your tweets

> **Note:** This is a fully client-side app. No data is sent to any server. API keys and categories are held in memory only and will be lost on page refresh — use Export Categories to save your work.

## Support

If you find this tool useful, consider supporting the project:

[GitHub Sponsors](https://github.com/sponsors/farizdp)

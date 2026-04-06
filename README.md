# X Exporter v5

Export your Twitter/X **Likes** and **Bookmarks** as CSV or JSON.

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
- **CSV / JSON** — downloads the collected tweets in your chosen format

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
- Likes: `x-[username]-likes-[YYYYMMDD].csv` / `.json`
- Bookmarks: `x-bookmarks-[YYYYMMDD].csv` / `.json`

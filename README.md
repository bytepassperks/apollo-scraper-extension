# Apollo Lead Exporter

Apollo Lead Exporter is a no-build Chrome Manifest V3 extension that exports people, contact, account, and organization search results already visible in your own logged-in Apollo.io session. It supports CSV (RFC 4180 with UTF-8 BOM) and JSON downloads.

## Install as an unpacked extension

1. Clone or download this repository.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select this repository directory.

## Usage

1. Log in to Apollo.io and open a people or company search.
2. Run the search and leave the results page open. The extension observes Apollo's own search response and arms itself; it does not issue a search request of its own.
3. Open **Apollo Lead Exporter** from the toolbar.
4. Choose maximum records, maximum pages, delay, output format, and fields.
5. Select **Start** to click through Apollo's visible results-page controls. Select **Stop** to halt. Select **Download** after the run completes. The popup may close while a run continues.

## How it works

The page-context script observes the search requests Apollo makes itself and retains the latest search response. During an export, the content script finds Apollo's visible next-page control using accessible labels, titles, and visible text, clicks it, and waits for the next intercepted search response. The extension never issues a search request in the default export flow. Records are deduplicated by ID, and pagination stops at the configured caps, a disabled or absent next control, an empty page, a timeout, or an Apollo error response.

Because Apollo can attach per-request anti-abuse challenges, the extension does not replay captured requests or reuse their headers.

The interceptor's structured response is preferred because it preserves fields such as employment history. If a response does not contain a recognized record collection, the extension falls back to visible rows using semantic grid/table roles and `aria-colindex` values; this fallback is intentionally limited to rendered fields. Pagination is located through visible controls with accessible labels, titles, or text such as **Next** or **Next page**, not Apollo's generated CSS classes.

The default delay is 2.5 seconds plus a small random jitter. The reference project [Apollo Free Email Scraper](https://github.com/tanmaytekale/apollo-scraper) recommends delays of 2–50 seconds and uses similar human-paced controls. This extension is an independent implementation; it does not click email/phone reveal controls and has no credit-spending mode. The reference project is MIT-licensed; its selectors and pacing guidance were consulted as reference, not copied.

The default fields follow the source actor's scraped-data table: contact identity and URLs, email and title details, organization details, employment history, location, engagement, departments, seniority, functions, phones, and intent fields. Nested values are represented as JSON strings in CSV. Missing or unknown values are blank. The source actor table's complete JSON structure is not available in the short README, so the **All fields** option also preserves unknown nested properties.

## Limitations and responsible use

- This extension only exports data visible in the user's own Apollo session. It does not bypass login, obtain credentials, or access records unavailable to that session.
- Apollo can change its request and response formats; the self-calibrating heuristic may need to be updated if Apollo changes its UI.
- Requests are intentionally delayed and capped, but the extension cannot guarantee Apollo rate-limit behavior.
- Use this tool only in compliance with Apollo's Terms of Service and all applicable data-protection, privacy, and marketing laws. You are responsible for having a lawful basis for any exported data and for handling downloads securely.
- Live Apollo testing is not included because this project cannot log in to Apollo.

## Development

There are no runtime or development dependencies. Run `npm test`; tests include flattening, CSV escaping, and a synthetic captured-request pagination fixture.

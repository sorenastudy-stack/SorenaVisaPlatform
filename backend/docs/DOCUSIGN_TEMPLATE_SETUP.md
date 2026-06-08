# DocuSign Template Setup — Sorena Engagement Letter

This is a one-time setup checklist for building the engagement-letter template inside DocuSign's web editor. Follow the numbered steps in order. After each big step there's a **"You should see"** line so you can confirm it worked before continuing.

You do this once for **DEMO** (now, for testing). Later, at go-live, you do the same steps inside DocuSign's **PRODUCTION** environment — different account, different template, separate templateId.

---

## Why this template exists

The Sorena platform code stamps the LIA's name and IAA Licence Number directly into the PDF before sending. Everything else — signatures, dates, the client's Full Name + Passport No, the director's Full Name, and the 11 visa-type checkboxes — comes from this template you're about to design.

You position those fields visually. The platform substitutes a freshly-stamped PDF at send time and overlays your field positions onto it.

---

## Before you start

- [ ] You have a DocuSign **DEMO** developer account login (https://appdemo.docusign.com).
- [ ] You have the engagement-letter PDF on your computer at:
  `backend/assets/contract-templates/engagement-letter-v1.pdf`
- [ ] You are NOT logged in to production DocuSign (`https://app.docusign.com`) — that's for later. The demo URL has the word "demo" in it.

---

## Step 1 — Create a new template and upload the PDF

1. Log in to https://appdemo.docusign.com.
2. In the top navigation, click **Templates**.
3. Click **New** (or **+ New Template** depending on UI version) → **Create Template**.
4. Drag `engagement-letter-v1.pdf` from your file explorer onto the upload area, OR click **Upload** and select the file.

> **Important — upload the UNSTAMPED original.**
> The four spots where the LIA's name + IAA licence number appear (page 1 Clause 2.1, page 11 LIA signature block) will be **blank** in the PDF you upload. That's correct. The Sorena platform stamps those values into the PDF automatically every time a contract is sent. If you upload a pre-filled copy, you'll see Sheila Rose's name forever.

**You should see:** the engagement letter appearing as a 11-page document preview on the right side of the screen.

---

## Step 2 — Name the template

In the **Template Name** field at the top, type exactly:

```
Sorena Engagement Letter — Multi-signer v1
```

Leave the **Description** field blank (optional, you can fill in later).

---

## Step 3 — Add the 3 recipient roles

These are placeholder "roles" that get filled with real people at send time. The platform looks them up by **exact name**, so any typo here breaks every send.

In the **Recipients** panel:

1. Click **Add Recipient**. A new row appears. Fill in:
   - **Name**: leave blank
   - **Email**: leave blank
   - **Role**: type exactly **`Client`** (capital C, no quotes)
   - **Action**: select **Needs to Sign**
2. Click **Add Recipient** again. Fill in:
   - **Name**: leave blank
   - **Email**: leave blank
   - **Role**: type exactly **`LIA`** (all caps, no quotes)
   - **Action**: select **Needs to Sign**
3. Click **Add Recipient** a third time. Fill in:
   - **Name**: leave blank
   - **Email**: leave blank
   - **Role**: type exactly **`Director`** (capital D, no quotes)
   - **Action**: select **Needs to Sign**

Then **enable sequential signing** so the three sign in order:

4. Find the toggle labelled **Set signing order** (usually above or beside the recipient list). Turn it **ON**.
5. The recipients now show a number (1, 2, 3) on the left. Make sure the order is:
   - 1 = Client
   - 2 = LIA
   - 3 = Director

   If the order is wrong, drag the rows to reorder.

**You should see:** three rows in the Recipients panel labelled (in order) **1 Client**, **2 LIA**, **3 Director** — each with **Needs to Sign** as the action and the Name/Email columns blank.

---

## Step 4 — Place the fields on the document

Click **Next** at the top right. The view switches to the field-placement editor — the document is in the middle, a palette of field types is on the left, and a recipient-color filter dropdown is somewhere near the top of the canvas.

> **Tip:** the recipient color filter lets you focus on one role at a time. The fields you place show up colour-coded — Client = one colour, LIA = another, Director = a third. Stick to one role at a time so you don't accidentally drop a Client field into the LIA's column.

### Step 4a — Place CLIENT fields (page 11 only)

1. In the recipient color filter at the top of the canvas, select **Client**.
2. Scroll the document preview to **page 11**. You'll see three signature blocks side by side. The **client block is the LEFT column**.
3. From the field palette on the left, drag and drop the following fields onto the client block:

   | Field type (in palette) | Drop onto | Required? |
   |---|---|---|
   | **Signature** | the `Signature:` line in the client (left) block | (auto) |
   | **Date Signed** | the `Date:` line in the client block | (auto) |
   | **Text** | the `Full Name:` line in the client block | **YES — Required** |
   | **Text** | the `Passport No:` line in the client block | **YES — Required** |

4. For each of the two Text fields you just dropped, click it once to select it. In the **Properties** panel that appears on the right (or as a popover), tick the **Required** box.

**You should see:** four client-coloured fields stacked vertically in the LEFT column of page 11, each landing on its labelled line. The two Text fields have a visible "Required" marker (usually a red asterisk).

### Step 4b — Place LIA fields (page 11 signature)

1. Change the recipient color filter at the top to **LIA**.
2. Still on **page 11**, locate the **LIA block — the MIDDLE column** (between Client on the left and Director on the right).
3. Drag from the palette onto the LIA block:

   | Field type | Drop onto | Required? |
   |---|---|---|
   | **Signature** | `Signature:` line in the LIA (middle) block | (auto) |
   | **Date Signed** | `Date:` line in the LIA block | (auto) |

**Do NOT drag a Text field onto the LIA's `Full Name:` line or `IAA Licence No:` line on page 11.** Those positions are stamped by code — adding fields would double up. (See the DO NOT box below for the full list.)

**You should see:** two LIA-coloured fields in the middle column of page 11, on the `Signature:` and `Date:` lines only. The `Full Name:` and `IAA Licence No:` lines stay empty in the editor view.

### Step 4c — Place the 11 visa-type checkboxes (pages 2-3, LIA only)

The LIA filter should still be active. If not, re-select **LIA** in the color dropdown.

1. Scroll to **page 2**. You'll see the Clause 3.3 visa-type table — three columns: **Tick** (empty), **Visa Type**, **Sorena Service Fee (NZD)**.
2. From the field palette, drag a **Checkbox** field onto the **Tick** column for each row. Place them in order:

   **Page 2:**
   - Row 1 — `Initial Student Visa` → Checkbox in the Tick column
   - Row 2 — `Student Visa Renewal` → Checkbox in the Tick column

   **Page 3:**
   - Row 3 — `Post-Study Work Visa (PSWV)` → Checkbox
   - Row 4 — `Dependent Partner Work Visa` → Checkbox
   - Row 5 — `Dependent Child Visa (per child)` → Checkbox
   - Row 6 — `Dependent Partner Visa Renewal` → Checkbox
   - Row 7 — `Dependent Child Visa Renewal (per child)` → Checkbox
   - Row 8 — `Visitor Visa` → Checkbox
   - Row 9 — `Work Visa (post-study, employer-sponsored)` → Checkbox
   - Row 10 — `Visa Variation / Condition Change` → Checkbox
   - Row 11 — `Visa Resubmission (one resubmission per declined visa)` → Checkbox

   That's **11 checkboxes** total, all coloured for the LIA.

3. As you place each one, **leave Required unchecked**. (The "must tick one" rule comes from the group constraint in the next step, not from each checkbox being individually required.)

**You should see:** 11 LIA-coloured checkboxes lined up in the Tick column — 2 on page 2, 9 on page 3.

### Step 4d — Group the 11 checkboxes so the LIA must pick EXACTLY one

This is the critical "pick exactly one visa type" rule. Without it, the LIA could tick zero or multiple boxes.

1. With the LIA color filter still active, **select all 11 checkboxes**:
   - Click the first checkbox.
   - Hold **Ctrl** (or **Cmd** on Mac) and click each of the other 10.
   - All 11 should now show a selected outline.
2. With all 11 selected, look for the **Group** option:
   - In the toolbar at the top, or
   - Right-click on one of the selected checkboxes → **Group** in the context menu.

   Click it.
3. A **Group properties** panel appears. Set the following:
   - **Group Name** (or "Group Label"): type **`visaType`** (lowercase v, camelCase — exact)
   - Tick the box **Validate selections within group** (the exact wording is sometimes "Validate selection requirements" or "Validation Rule").
   - **Minimum selections required**: type **`1`**
   - **Maximum selections allowed**: type **`1`**
4. Close the Group properties panel (Save / OK / X).

**You should see:** the 11 checkboxes now share a visible group indicator (a coloured border around them, or a "Group: visaType" label in their properties). When the LIA signs, DocuSign will not let them finish unless exactly one is ticked.

### Step 4e — Place DIRECTOR fields (page 11 only)

1. Change the recipient color filter at the top to **Director**.
2. Still on **page 11**, locate the **Director block — the RIGHT column**.
3. Drag from the palette onto the Director block:

   | Field type | Drop onto | Required? |
   |---|---|---|
   | **Signature** | `Signature:` line in the Director (right) block | (auto) |
   | **Date Signed** | `Date:` line in the Director block | (auto) |
   | **Text** | `Full Name:` line in the Director block | **NO — leave unrequired** |

4. For the Text field, you can leave it blank. **Do NOT type a default name into it** — the platform passes the director's name at send time.

**You should see:** three Director-coloured fields in the RIGHT column of page 11, on `Signature:`, `Full Name:`, and `Date:`.

---

## ⚠️ DO NOT place fields in these positions

The following four positions are **stamped into the PDF by the platform** at send time. If you place a DocuSign field here, two values render on top of each other.

| Page | Position | What the platform stamps there |
|---|---|---|
| Page 1 (Clause 2.1) | beside `Name:` | LIA's full name |
| Page 1 (Clause 2.1) | beside `IAA Licence Number:` | LIA's IAA Licence Number |
| Page 11 LIA-block (middle column) | beside `Full Name:` | LIA's full name |
| Page 11 LIA-block (middle column) | beside `IAA Licence No:` | LIA's IAA Licence Number |

Leave those four spots empty in the editor. You will see them auto-filled when a real envelope is sent.

---

## Step 5 — Preview the template

Before saving, click **Preview** (top right, or under a menu).

1. Step through each recipient's view using the recipient selector — Client first, then LIA, then Director.
2. For each recipient, scroll through every page and confirm:
   - **Page 1:** the `Name:` and `IAA Licence Number:` lines in Clause 2.1 are empty (they will be filled at send).
   - **Pages 2-3:** the 11 visa checkboxes are visible **only for the LIA** preview (not for Client or Director).
   - **Page 11:** each recipient sees their own block's fields highlighted. The middle column's `Full Name:` and `IAA Licence No:` lines are empty (stamp positions).
3. Try the LIA's preview — confirm DocuSign warns if you try to finish without ticking any visa box, and won't let you tick more than one. (If it lets you tick zero or multiple, the group settings in Step 4d are wrong — go back and fix.)

**Close Preview** when satisfied.

---

## Step 6 — Save the template

Click **Save and Close** (top right).

**You should see:** the template now appears in your **Templates** list with the name `Sorena Engagement Letter — Multi-signer v1`.

---

## Step 7 — Find and copy the templateId

1. From your Templates list, click on `Sorena Engagement Letter — Multi-signer v1` to open it.
2. The browser URL bar now shows something like:
   `https://appdemo.docusign.com/.../templates/<TEMPLATE_ID>/...`
3. The **templateId** is the long alphanumeric string in the URL — looks like `abcdef12-3456-7890-1234-567890abcdef` (UUID format, 36 characters with dashes).
4. Alternatively, click **Template Properties** (or the **Info** / **⋮** menu on the template card) — the templateId appears under **Template ID** or **API ID**.

**Copy that templateId** and paste it into your reply to me.

---

## Quick reference — all fields at a glance

| Page | Column / Block | Role | Line | Field type | Required? |
|---|---|---|---|---|---|
| 1 (Clause 2.1) | — | — | `Name:` | **(stamped by code)** | — |
| 1 (Clause 2.1) | — | — | `IAA Licence Number:` | **(stamped by code)** | — |
| 2-3 (Clause 3.3) | Tick column | LIA | each of 11 visa rows | Checkbox | grouped, min=1 max=1 |
| 11 | Left block | Client | `Signature:` | Signature | auto |
| 11 | Left block | Client | `Full Name:` | Text | **Required** |
| 11 | Left block | Client | `Passport No:` | Text | **Required** |
| 11 | Left block | Client | `Date:` | Date Signed | auto |
| 11 | Middle block | LIA | `Signature:` | Signature | auto |
| 11 | Middle block | LIA | `Full Name:` | **(stamped by code)** | — |
| 11 | Middle block | LIA | `IAA Licence No:` | **(stamped by code)** | — |
| 11 | Middle block | LIA | `Date:` | Date Signed | auto |
| 11 | Right block | Director | `Signature:` | Signature | auto |
| 11 | Right block | Director | `Full Name:` | Text | not required |
| 11 | Right block | Director | `Date:` | Date Signed | auto |

**Totals:**
- 3 recipient roles (Client / LIA / Director — exact spelling)
- 11 visa checkboxes (LIA-only, grouped with min=1 max=1)
- 11 other interactive fields (4 Client + 2 LIA + 3 Director + 2 Date Signed implicit)
- 4 stamped positions (do NOT add fields here)

---

## What to send back

Reply with:

1. The **templateId** you copied in Step 7.
2. (Optional) A screenshot of the Recipients panel showing the 3 roles named Client / LIA / Director with the signing-order toggle ON.
3. (Optional) A screenshot of page 11 showing the colored fields in each of the three columns.

Once I have the templateId, I'll wire it into the platform (piece 5H.1) and we'll send a real test envelope to confirm everything lines up.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Send fails with `TEMPLATE_ROLE_NOT_FOUND` | role name typo | open template, fix role spelling to exactly `Client` / `LIA` / `Director` |
| LIA can finish without ticking any visa | group constraint missing or min ≠ 1 | re-open template, redo Step 4d, set Min=1 Max=1 |
| LIA can tick multiple visas | group's Max is set to a value other than 1 | re-open template, fix Max to 1 |
| Fields land in the wrong place on page 11 | placed in wrong column (Client vs LIA vs Director blocks) | re-open template, switch recipient color, drag to correct column |
| Stamped name doubled-up with a tab on page 1 | a Text field was placed where the platform stamps | re-open template, delete the offending Text field; the stamped name fills automatically |

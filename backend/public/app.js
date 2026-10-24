
/* Ayuva frontend logic.
   The backend (/api/v1) is authoritative for auth, triage and saved data.
   No passwords, tokens or health data are stored in browser storage.
*/
"use strict";

/* ---------- API layer ---------- */

class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const friendly = (err, status) => {
  if (status >= 500) {
    return "Something went wrong on our side. Please try again in a moment.";
  }
  if (err?.code === "UNAUTHENTICATED") {
    return "Please sign in again.";
  }
  return err?.message || "Request failed. Please try again.";
};

const API = {
  base: (
    document.querySelector('meta[name="ayuva-api-base"]')?.content ||
    "/api/v1"
  ).replace(/\/$/, ""),

  csrf: null,

  async ensureCsrf(force) {
    if (!this.csrf || force) {
      let res;

      try {
        res = await fetch(this.base + "/auth/csrf", {
          credentials: "include"
        });
      } catch {
        throw new ApiError(
          "NETWORK",
          "Cannot reach Ayuva right now. Check your connection and try again.",
          0
        );
      }

      if (!res.ok) {
        throw new ApiError(
          "CSRF_UNAVAILABLE",
          "Could not start a secure session. Please reload the page.",
          res.status
        );
      }

      this.csrf = (await res.json()).csrfToken;
    }

    return this.csrf;
  },

  async request(path, { method = "GET", body, retry = true } = {}) {
    const headers = {};

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (method !== "GET") {
      headers["X-CSRF-Token"] = await this.ensureCsrf();
    }

    let res;

    try {
      res = await fetch(this.base + path, {
        method,
        credentials: "include",
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });
    } catch {
      throw new ApiError(
        "NETWORK",
        "Cannot reach Ayuva right now. Check your connection and try again.",
        0
      );
    }

    let data = null;

    try {
      data = await res.json();
    } catch {
      // The response was not JSON.
    }

    if (
      res.status === 403 &&
      data?.error?.code === "CSRF_INVALID" &&
      retry
    ) {
      this.csrf = null;
      await this.ensureCsrf(true);
      return this.request(path, { method, body, retry: false });
    }

    if (!res.ok) {
      throw new ApiError(
        data?.error?.code || "ERROR",
        friendly(data?.error, res.status),
        res.status
      );
    }

    return data;
  },

  chat: (state, message) =>
    API.request("/chat", {
      method: "POST",
      body: { state, message }
    }),

  knowledge: () =>
    API.request("/knowledge").then(r => r.entries),

  async saveHistory(e) {
    return API.request("/history", {
      method: "POST",
      body: {
        date: e.date,
        title: e.title,
        urgency: e.level ? "urgent" : "routine"
      }
    });
  },

  async getHistory() {
    const response = await API.request("/history");

    return response.history.map(h => ({
      ...h,
      level:
        h.urgency === "routine" || h.urgency === "unknown" ? 0 : 1
    }));
  },

  async getCheckins() {
    const response = await API.request("/checkins");

    return Object.fromEntries(
      response.checkins.map(c => [c.date, c])
    );
  },

  saveCheckin: e =>
    API.request("/checkins/" + e.date, {
      method: "PUT",
      body: {
        mood: e.mood,
        energy: e.energy,
        digestion: e.digestion,
        sleep: e.sleep
      }
    }),

  async getReminders() {
    return (await API.request("/reminders")).reminders;
  },

  addReminder: r =>
    API.request("/reminders", {
      method: "POST",
      body: { name: r.name, time: r.time }
    }).then(x => x.reminder),

  setTaken: (id, takenOn) =>
    API.request("/reminders/" + id, {
      method: "PATCH",
      body: { takenOn }
    }).then(x => x.reminder),

  delReminder: id =>
    API.request("/reminders/" + id, { method: "DELETE" }),

  async getCalendar(year) {
    const response = await API.request(
      `/calendar/summary?from=${year}-01-01&to=${year}-12-31`
    );

    const symptoms = {};

    response.history.forEach(h => {
      (symptoms[h.date] = symptoms[h.date] || []).push({
        ...h,
        level:
          h.urgency === "routine" || h.urgency === "unknown" ? 0 : 1
      });
    });

    return {
      ci: Object.fromEntries(
        response.checkins.map(c => [c.date, c])
      ),
      sym: symptoms,
      year
    };
  },

  async exportData() {
    return API.request("/privacy/export");
  },

  deleteAccount: password =>
    API.request("/auth/account", {
      method: "DELETE",
      body: { password }
    })
};

/* ---------- Constants ---------- */

const TOPIC_LABELS = [
  "Fever",
  "Cough or cold",
  "Headache",
  "Bloating or gas",
  "Stress or poor sleep"
];

const TOPIC_TERM = {
  fever: "fever",
  cough: "cough",
  headache: "headache",
  digestion: "bloating",
  stress: "stress"
};

const EVIDENCE_LABEL = {
  guideline: "Public-health guidance",
  systematic_review: "Systematic review",
  clinical_trial: "Clinical trial",
  observational: "Observational research",
  preclinical: "Lab/animal research only",
  traditional_source: "Traditional source only",
  insufficient: "Evidence insufficient"
};

/* ---------- Helpers ---------- */

const $ = (selector, element = document) =>
  element.querySelector(selector);

const esc = value =>
  String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);

const today = () => {
  const date = new Date();

  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
};

document.querySelectorAll("[data-close]").forEach(button => {
  button.addEventListener("click", () => {
    button.closest("dialog")?.close();
  });
});

document.querySelectorAll("dialog").forEach(dialog => {
  dialog.addEventListener("click", event => {
    if (event.target === dialog && !dialog.id.includes("authDlg")) {
      dialog.close();
    }
  });
});

/* ---------- Quick symptom chips ---------- */

const QUICK = ["cough", "headache", "bloating", "stress"];

function fillChecker(term) {
  $("#q").value = term;
  $("#checker").scrollIntoView();
  $("#checkForm").requestSubmit();
}

$("#heroChips").innerHTML = QUICK.map(term => `
  <button
    class="chip !bg-transparent border-ondeep/40 hover:!bg-ondeep hover:!text-deep"
    data-term="${term}">
    ${term}
  </button>
`).join("");

$("#quickChips").innerHTML = QUICK.map(term => `
  <button class="chip" data-term="${term}">${term}</button>
`).join("");

document.addEventListener("click", event => {
  const button = event.target.closest("[data-term]");
  if (button) fillChecker(button.dataset.term);
});

/* ---------- Reviewed educational content ---------- */

async function loadRemedies() {
  const grid = $("#remedyGrid");

  try {
    const entries = await API.knowledge();

    grid.innerHTML = entries.length
      ? entries.map(remedy => `
        <article class="rounded-2xl border border-line bg-card p-6 flex flex-col">
          <h3 class="text-xl font-semibold">${esc(remedy.title)}</h3>

          <p class="mt-2 text-sm font-semibold text-gold">
            Traditional use
          </p>

          <p class="text-muted">
            ${esc(remedy.traditionalUseSummary ||
              "No traditional-use summary recorded.")}
          </p>

          <p class="mt-3 text-sm font-semibold text-leaf">
            Evidence:
            ${esc(EVIDENCE_LABEL[remedy.evidenceLevel] ||
              remedy.evidenceLevel)}
          </p>

          <p class="mt-1 text-sm text-muted flex-1">
            ${esc(remedy.whenToSeekCare || "")}
          </p>

          <button
            class="mt-4 self-start text-sm font-semibold text-leaf underline underline-offset-4"
            data-term="${esc(TOPIC_TERM[remedy.topic] || remedy.topic)}">
            See guidance for ${esc(remedy.title.toLowerCase())}
          </button>
        </article>
      `).join("")
      : `
        <p class="text-muted md:col-span-2">
          Reviewed educational entries are not available yet.
          You can still use the symptom checker.
        </p>
      `;
  } catch (error) {
    grid.innerHTML = `
      <p class="text-muted md:col-span-2">
        Educational entries are temporarily unavailable.
        ${esc(error.message)}
      </p>
    `;
  }
}

/* ---------- Symptom checker results ---------- */

const list = (items, className = "") => `
  <ul class="mt-3 space-y-2">
    ${items.map(item => `
      <li class="flex gap-2">
        <span class="${className} mt-2 w-1.5 h-1.5 rounded-full bg-current shrink-0"></span>
        <span>${esc(item)}</span>
      </li>
    `).join("")}
  </ul>
`;

const card = (title, body, extra = "") => `
  <section class="rounded-2xl border border-line bg-bg p-6 ${extra}">
    <h3 class="text-xl font-semibold">${title}</h3>
    ${body}
  </section>
`;

const safeHref = url =>
  /^https?:\/\//i.test(url || "") ? url : "#";

function renderResult(plan, banner = "") {
  const evidence = (plan.evidence || []).map(item => `
    <li class="mt-3">
      <span class="text-sm font-semibold text-leaf">
        ${esc(EVIDENCE_LABEL[item.level] || item.level)}
      </span>
      <p>${esc(item.summary)}</p>
      <p class="text-sm text-muted">
        Limits: ${esc(item.limitations)}
      </p>
    </li>
  `).join("");

  const sources = (plan.sources || []).map(source => `
    <li>
      <a
        class="underline underline-offset-4"
        href="${esc(safeHref(source.url))}"
        target="_blank"
        rel="noopener noreferrer">
        ${esc(source.title)}
      </a>
      <span class="text-sm text-muted">
        · ${esc(source.organization || "")}
      </span>
    </li>
  `).join("");

  $("#results").insertAdjacentHTML("beforeend", `
    <div class="fade">
      ${banner}

      <h3 class="text-2xl font-semibold mb-2">
        ${esc(plan.title)}
      </h3>

      <p class="mb-5">${esc(plan.summary)}</p>

      <div class="grid gap-5 md:grid-cols-2">
        ${(plan.traditionalUse || []).length
          ? card(
              "Traditional use (not proof of effectiveness)",
              list(plan.traditionalUse, "text-gold")
            )
          : ""}

        ${card("What the evidence says", `<ul>${evidence}</ul>`)}

        ${(plan.selfCare || []).length
          ? card(
              "General self-care ideas",
              list(plan.selfCare, "text-leaf"),
              "md:col-span-2"
            )
          : ""}

        ${(plan.avoidOrCaution || []).length
          ? card(
              "Be careful with",
              list(plan.avoidOrCaution, "text-warn")
            )
          : ""}

        ${(plan.redFlags || []).length
          ? card(
              "Warning signs",
              list(plan.redFlags, "text-warn")
            )
          : ""}

        ${card(
          "When to see a clinician",
          `<p class="mt-3">${esc(plan.whenToSeekCare || "")}</p>`,
          "md:col-span-2"
        )}

        ${sources
          ? card(
              "Sources",
              `<ul class="mt-3 space-y-2">${sources}</ul>`,
              "md:col-span-2"
            )
          : ""}
      </div>

      <p class="mt-5 text-sm text-muted">
        ${plan.origin === "llm"
          ? "Wording assisted by AI and restricted to reviewed sources. "
          : ""}
        Educational only, not a diagnosis. If symptoms last more than
        a few days or get worse, please see a doctor.
      </p>
    </div>
  `);
}

/* ---------- Daily check-in ---------- */

const OPTIONS = {
  mood: ["Low", "Okay", "Good", "Great"],
  energy: ["Tired", "Steady", "Energised"],
  digestion: ["Heavy", "Normal", "Light"]
};

const picked = {};

document.querySelectorAll("[data-group]").forEach(group => {
  const key = group.dataset.group;

  group.innerHTML = (OPTIONS[key] || []).map(option => `
    <button type="button" class="chip" aria-pressed="false">
      ${option}
    </button>
  `).join("");

  group.addEventListener("click", event => {
    const button = event.target.closest(".chip");
    if (!button) return;

    group.querySelectorAll(".chip").forEach(chip => {
      chip.setAttribute("aria-pressed", "false");
    });

    button.setAttribute("aria-pressed", "true");
    picked[key] = button.textContent.trim();
  });
});

async function renderWeek() {
  renderCal();

  const all = Auth.cur
    ? await API.getCheckins().catch(() => ({}))
    : {};

  const days = [];

  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    days.push(date);
  }

  $("#week").innerHTML = days.map(date => {
    const key = iso(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );

    const done = !!all[key];

    return `
      <div class="text-center text-xs text-muted">
        <div
          class="w-9 h-9 rounded-full grid place-items-center border border-line ${done ? "bg-leaf text-white border-leaf" : ""}"
          title="${done ? "Checked in" : "No check-in"}">
          ${done ? "&#10003;" : ""}
        </div>
        ${date.toLocaleDateString("en", { weekday: "narrow" })}
      </div>
    `;
  }).join("");
}

$("#checkinForm").addEventListener("submit", async event => {
  event.preventDefault();

  const message = $("#checkinMsg");

  if (!picked.mood || !picked.energy || !picked.digestion) {
    message.className = "text-sm text-warn";
    message.textContent =
      "Choose mood, energy and digestion first.";
    return;
  }

  try {
    await API.saveCheckin({
      date: today(),
      ...picked,
      sleep: Number($("#sleep").value)
    });

    message.className = "text-sm text-leaf";
    message.textContent = "Check-in saved.";
    await renderWeek();
  } catch (error) {
    message.className = "text-sm text-warn";
    message.textContent = error.message;
  }
});

/* ---------- Reminders ---------- */

let reminders = [];

const remMsg = message => {
  $("#remMsg").textContent = message || "";
};

function renderReminders() {
  const date = today();

  reminders.sort((a, b) => a.time.localeCompare(b.time));

  const done = reminders.filter(
    reminder => reminder.takenOn === date
  ).length;

  $("#progress").textContent = reminders.length
    ? `${done} of ${reminders.length} taken today`
    : "";

  $("#remList").innerHTML = reminders.length
    ? reminders.map(reminder => `
      <li class="flex items-center gap-3 py-3">
        <input
          type="checkbox"
          id="r${esc(reminder.id)}"
          data-id="${esc(reminder.id)}"
          ${reminder.takenOn === date ? "checked" : ""}>

        <label
          for="r${esc(reminder.id)}"
          class="flex-1 ${reminder.takenOn === date
            ? "line-through text-muted"
            : ""}">
          ${esc(reminder.name)}
          <span class="block text-sm text-muted">
            ${esc(reminder.time)}
          </span>
        </label>

        <button
          class="text-sm text-muted underline"
          data-del="${esc(reminder.id)}"
          aria-label="Remove ${esc(reminder.name)}">
          Remove
        </button>
      </li>
    `).join("")
    : `
      <li class="py-4 text-muted">
        No reminders yet. Add your first reminder below.
      </li>
    `;
}

$("#remList").addEventListener("change", async event => {
  const id = event.target.dataset.id;
  if (!id) return;

  const reminder = reminders.find(item => item.id === id);
  if (!reminder) return;

  remMsg();

  try {
    Object.assign(
      reminder,
      await API.setTaken(
        id,
        event.target.checked ? today() : null
      )
    );
  } catch (error) {
    event.target.checked = !event.target.checked;
    remMsg(error.message);
  }

  renderReminders();
});

$("#remList").addEventListener("click", async event => {
  const id = event.target.dataset.del;
  if (!id) return;

  remMsg();

  try {
    await API.delReminder(id);
    reminders = reminders.filter(item => item.id !== id);
    renderReminders();
  } catch (error) {
    remMsg(error.message);
  }
});

$("#remForm").addEventListener("submit", async event => {
  event.preventDefault();

  const name = $("#remName").value.trim();
  if (!name) return;

  remMsg();

  try {
    reminders.push(await API.addReminder({
      name,
      time: $("#remTime").value
    }));

    $("#remName").value = "";
    renderReminders();
  } catch (error) {
    remMsg(error.message);
  }
});

/* ---------- Symptom checker chat ---------- */

let chatState = { topic: null };
let busy = false;

function bubble(message, isUser = false) {
  const element = document.createElement("div");

  element.className =
    "fade max-w-[85%] rounded-2xl px-4 py-3 " +
    (isUser
      ? "ml-auto bg-deep text-ondeep"
      : "bg-bg border border-line");

  element.textContent = message;

  $("#results").appendChild(element);
  element.scrollIntoView({ block: "nearest" });
}

function setOpts(options = []) {
  $("#replyOpts").innerHTML = (options || []).map(option => `
    <button class="chip" data-reply="${esc(option)}">
      ${esc(option)}
    </button>
  `).join("");
}

function showRedFlag(message) {
  $("#rfExtra").textContent = message || "";

  const dialog = $("#redFlag");

  if (!dialog.open) dialog.showModal();

  $("#rfCall").focus();
}

async function send(message) {
  if (busy) return;

  busy = true;
  setOpts();
  bubble(message, true);
  $("#formMsg").textContent = "";

  try {
    const response = await API.chat(chatState, message);

    chatState = response.state || { topic: null };

    if (response.reply) bubble(response.reply);

    if (response.emergency) {
      showRedFlag(response.reply);
    }

    let options = response.options || [];

    if (response.plan) {
      const borderClass = response.level
        ? "border-gold"
        : "border-leaf";

      const llmNotice = response.fallbackReason
        ? `<div class="mb-4 rounded-xl border border-gold bg-bg p-3 text-sm">
            AI enhancement is unavailable (${esc(response.fallbackReason)}). Showing the available curated information instead.
          </div>`
        : "";

      renderResult(
        response.plan,
        llmNotice + `<div class="mb-5 rounded-xl border ${borderClass} bg-bg p-4">
          ${esc(response.note || "")}
        </div>`
      );

      if (Auth.cur) {
        try {
          await API.saveHistory({
            date: today(),
            title: response.plan.title,
            level: response.level
          });

          await renderHistory();
        } catch (error) {
          $("#formMsg").textContent =
            "Your result is shown, but it could not be saved: " +
            error.message;
        }
      } else {
        options = ["Sign in to save this", ...options];
      }
    }

    setOpts(options);
  } catch (error) {
    $("#formMsg").textContent = error.message;

    setOpts(
      chatState.topic ? ["Start over"] : TOPIC_LABELS
    );
  } finally {
    busy = false;
  }
}

$("#checkForm").addEventListener("submit", event => {
  event.preventDefault();

  const input = $("#q");
  const message = $("#formMsg");
  const question = input.value.trim();

  message.textContent = "";

  if (question.length < 2) {
    message.textContent =
      "Type a few words about how you feel.";
    return;
  }

  input.value = "";
  send(question);
});

document.addEventListener("click", event => {
  const button = event.target.closest("[data-reply]");
  if (!button) return;

  if (button.dataset.reply.startsWith("Sign in")) {
    openAuth("in");
  } else {
    send(button.dataset.reply);
  }
});

/* ---------- Authentication ---------- */

const Auth = {
  cur: null,

  async load() {
    try {
      this.cur = (await API.request("/auth/me")).user;
      return true;
    } catch (error) {
      this.cur = null;
      return error.status === 401;
    }
  },

  async signup(data) {
    const response = await API.request("/auth/signup", {
      method: "POST",
      body: {
        name: data.name.trim(),
        email: data.email.trim(),
        password: data.password,
        age: data.age ? Number(data.age) : undefined
      }
    });

    this.cur = response.user;
  },

  async login(data) {
    const response = await API.request("/auth/login", {
      method: "POST",
      body: {
        email: data.email.trim(),
        password: data.password
      }
    });

    this.cur = response.user;
  },

  async logout() {
    try {
      await API.request("/auth/logout", { method: "POST" });
    } catch {
      // The session cookie may already be invalid.
    }

    this.cur = null;
  }
};

let authMode = "in";

function openAuth(mode) {
  authMode = mode;

  const signupMode = mode === "up";

  document.querySelectorAll(".up-only").forEach(element => {
    element.hidden = !signupMode;
  });

  $("#authTitle").textContent = signupMode
    ? "Create your Ayuva account"
    : "Sign in to Ayuva";

  $("#authGo").textContent = signupMode
    ? "Create account"
    : "Sign in";

  $("#authSwap").textContent = signupMode
    ? "I already have an account"
    : "New here? Create an account";

  $("#aPass").autocomplete = signupMode
    ? "new-password"
    : "current-password";

  $("#authMsg").textContent = "";

  if (!$("#authDlg").open) {
    $("#authDlg").showModal();
  }
}

$("#authSwap").addEventListener("click", () => {
  openAuth(authMode === "in" ? "up" : "in");
});

/* Keep the authentication dialog open for guests. */
$("#authDlg").addEventListener("cancel", event => {
  if (!Auth.cur) event.preventDefault();
});

/* Sign-in button / sign-out action. */
$("#authBtn").addEventListener("click", async () => {
  if (Auth.cur) {
    await Auth.logout();

    document.body.classList.add("auth-locked");

    await afterAuth();
    openAuth("up");
  } else {
    openAuth("in");
  }
});

/* Signup and login form. */
$("#authForm").addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.target;
  const data = Object.fromEntries(new FormData(form));
  const message = $("#authMsg");

  if (authMode === "up" && !data.name?.trim()) {
    message.textContent = "Enter your name.";
    return;
  }

  if (!/^\S+@\S+\.\S+$/.test(data.email || "")) {
    message.textContent = "Enter a valid email address.";
    return;
  }

  if (!data.password || data.password.length < 8) {
    message.textContent =
      "Use a password of at least 8 characters.";
    return;
  }

  try {
    if (authMode === "up") {
      await Auth.signup(data);
    } else {
      await Auth.login(data);
    }

    document.body.classList.remove("auth-locked");

    $("#authDlg").close();
    form.reset();

    await afterAuth();
  } catch (error) {
    message.textContent = error.message;
  }
});

/* Require login for routine tracking features. */
const gate = event => {
  if (Auth.cur) return;

  if (
    event.type === "click" &&
    !event.target.closest("[data-del]")
  ) {
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();

  if (event.type === "change") {
    event.target.checked = !event.target.checked;
  }

  openAuth("in");
};

["submit", "change", "click"].forEach(type => {
  $("#routine").addEventListener(type, gate, true);
});

/* ---------- History and post-auth refresh ---------- */

async function renderHistory() {
  renderCal();

  let history = [];

  if (Auth.cur) {
    try {
      history = await API.getHistory();
    } catch (error) {
      $("#histList").innerHTML = `
        <li class="py-2 text-muted">${esc(error.message)}</li>
      `;
      return;
    }
  }

  $("#histList").innerHTML = history.length
    ? history.slice(0, 6).map(item => `
      <li class="py-2 flex justify-between gap-3">
        <span>${esc(item.title)}</span>
        <span class="text-sm text-muted">${esc(item.date)}</span>
      </li>
    `).join("")
    : `
      <li class="py-2 text-muted">
        ${Auth.cur
          ? "No symptom checks saved yet."
          : "Sign in to see your history."}
      </li>
    `;
}

async function afterAuth() {
  const user = Auth.cur;

  $("#authBtn").textContent = user
    ? `Hi ${user.name.split(" ")[0]}, sign out`
    : "Sign in";

  $("#guestNote").hidden = !!user;
  $("#privacyRow").hidden = !user;

  if (user) {
    try {
      reminders = await API.getReminders();
      remMsg("");
    } catch (error) {
      reminders = [];
      remMsg(error.message);
    }
  } else {
    reminders = [];
  }

  renderReminders();
  await renderWeek();
  await renderHistory();
}

/* ---------- Privacy: export and delete ---------- */

$("#exportBtn").addEventListener("click", async () => {
  const message = $("#privMsg");
  message.textContent = "";

  try {
    const data = await API.exportData();

    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify(data, null, 2)],
        { type: "application/json" }
      )
    );

    const link = document.createElement("a");
    link.href = url;
    link.download = "ayuva-export.json";

    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    message.textContent = "Download started.";
  } catch (error) {
    message.textContent = error.message;
  }
});

$("#deleteBtn").addEventListener("click", () => {
  $("#delMsg").textContent = "";
  $("#delPass").value = "";
  $("#delDlg").showModal();
});

$("#delForm").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    await API.deleteAccount($("#delPass").value);

    Auth.cur = null;
    document.body.classList.add("auth-locked");

    $("#delDlg").close();

    await afterAuth();

    $("#privMsg").textContent = "";
    $("#guestNote").textContent =
      "Your account and saved data were deleted.";

    openAuth("up");
  } catch (error) {
    $("#delMsg").textContent = error.message;
  }
});

/* ---------- Health calendar ---------- */

const MOOD = {
  Low: "var(--warn)",
  Okay: "var(--gold)",
  Good: "color-mix(in srgb, var(--leaf) 65%, var(--card))",
  Great: "var(--leaf)"
};

const iso = (year, month, day) =>
  year +
  "-" +
  String(month + 1).padStart(2, "0") +
  "-" +
  String(day).padStart(2, "0");

const calView = {
  y: new Date().getFullYear(),
  m: new Date().getMonth(),
  mode: "month",
  sel: today()
};

let calData = { ci: {}, sym: {}, year: null };

$("#calLegend").innerHTML =
  Object.entries(MOOD).map(([name, color]) => `
    <span class="inline-flex items-center gap-1.5">
      <i
        class="w-3 h-3 rounded-sm inline-block"
        style="background:${color}">
      </i>
      ${name}
    </span>
  `).join("") +
  `
    <span class="inline-flex items-center gap-1.5">
      <i class="w-3 h-3 rounded-sm inline-block outline outline-2 outline-ink"></i>
      Symptom check
    </span>
  `;

function dayCell(year, month, day, small) {
  const key = iso(year, month, day);
  const checkin = calData.ci[key];

  const ring = calData.sym[key]
    ? "outline outline-2 outline-offset-1 outline-ink"
    : "";

  const background = checkin
    ? `background:${MOOD[checkin.mood] || "var(--line)"};color:#fff`
    : "";

  if (small) {
    return `
      <button
        data-date="${key}"
        class="w-4 h-4 rounded-sm bg-line/50 ${ring}"
        style="${background}"
        aria-label="${key}">
      </button>
    `;
  }

  const selected = calView.sel === key ? "ring-2 ring-gold" : "";
  const current = today() === key
    ? "font-bold border-ink"
    : "border-line";

  return `
    <button
      data-date="${key}"
      class="aspect-square rounded-lg text-sm grid place-items-center border ${current} ${selected} ${ring}"
      style="${background}"
      aria-label="${key}">
      ${day}
    </button>
  `;
}

function monthGrid(year, month, small) {
  const leadingDays =
    (new Date(year, month, 1).getDay() + 6) % 7;

  const daysInMonth =
    new Date(year, month + 1, 0).getDate();

  let html = `
    <div class="grid grid-cols-7 ${small ? "gap-1 w-max" : "gap-2"}">
  `;

  if (!small) {
    html += ["M", "T", "W", "T", "F", "S", "S"]
      .map(day => `
        <div class="text-center text-xs text-muted">${day}</div>
      `)
      .join("");
  }

  html += "<span></span>".repeat(leadingDays);

  for (let day = 1; day <= daysInMonth; day++) {
    html += dayCell(year, month, day, small);
  }

  return html + "</div>";
}

async function renderCal(reload = true) {
  const view = calView;
  const body = $("#calBody");

  if (!Auth.cur) {
    body.innerHTML = `
      <p class="text-muted">
        Sign in to track your check-ins and symptom checks by month and year.
      </p>
    `;

    $("#calTitle").textContent = "";
    $("#calStats").innerHTML = "";
    $("#calDetail").innerHTML = "";
    return;
  }

  if (reload || calData.year !== view.y) {
    try {
      calData = await API.getCalendar(view.y);
    } catch (error) {
      body.innerHTML = `
        <p class="text-muted">${esc(error.message)}</p>
      `;
      return;
    }
  }

  document.querySelectorAll("[data-calmode]").forEach(button => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.calmode === view.mode)
    );
  });

  const yearView = view.mode === "year";
  const prefix = yearView
    ? String(view.y)
    : iso(view.y, view.m, 1).slice(0, 7);

  $("#calTitle").textContent = yearView
    ? view.y
    : new Date(view.y, view.m).toLocaleDateString("en", {
        month: "long",
        year: "numeric"
      });

  body.innerHTML = yearView
    ? `
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-6">
        ${Array.from({ length: 12 }, (_, month) => `
          <div>
            <button
              data-month="${month}"
              class="font-semibold text-sm mb-2 underline-offset-4 hover:underline">
              ${new Date(view.y, month).toLocaleDateString("en", {
                month: "long"
              })}
            </button>
            ${monthGrid(view.y, month, true)}
          </div>
        `).join("")}
      </div>
    `
    : monthGrid(view.y, view.m, false);

  const keys = Object.keys(calData.ci).filter(
    key => key.startsWith(prefix)
  );

  const moods = {};
  let sleepTotal = 0;
  let sleepCount = 0;

  keys.forEach(key => {
    const checkin = calData.ci[key];

    moods[checkin.mood] = (moods[checkin.mood] || 0) + 1;

    if (checkin.sleep) {
      sleepTotal += Number(checkin.sleep);
      sleepCount++;
    }
  });

  const mostCommonMood = Object.entries(moods)
    .sort((a, b) => b[1] - a[1])[0];

  const symptomChecks = Object.keys(calData.sym)
    .filter(key => key.startsWith(prefix))
    .reduce((count, key) => count + calData.sym[key].length, 0);

  $("#calStats").innerHTML = [
    ["Check-ins", keys.length],
    [
      "Average sleep",
      sleepCount
        ? (sleepTotal / sleepCount).toFixed(1) + " h"
        : "none yet"
    ],
    ["Most common mood", mostCommonMood ? mostCommonMood[0] : "none yet"],
    ["Symptom checks", symptomChecks]
  ].map(([label, value]) => `
    <div>
      <span class="text-sm text-muted">${label}</span>
      <span class="serif text-xl ml-1">${value}</span>
    </div>
  `).join("");

  renderCalDetail();
}

function renderCalDetail() {
  const key = calView.sel;
  const element = $("#calDetail");

  if (!key) {
    element.innerHTML = `
      <p class="text-muted">Select a day to see what you logged.</p>
    `;
    return;
  }

  const checkin = calData.ci[key];
  const symptoms = calData.sym[key] || [];

  const label = new Date(key + "T00:00").toLocaleDateString("en", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });

  element.innerHTML = `
    <h3 class="text-xl font-semibold">${esc(label)}</h3>
    ${
      checkin
        ? `
          <ul class="mt-3 space-y-1 text-sm">
            <li>Mood: ${esc(checkin.mood)}</li>
            <li>Energy: ${esc(checkin.energy)}</li>
            <li>Digestion: ${esc(checkin.digestion)}</li>
            <li>Sleep: ${esc(checkin.sleep)} h</li>
          </ul>
        `
        : `
          <p class="mt-3 text-sm text-muted">
            No check-in saved for this day.
          </p>
        `
    }
    ${
      symptoms.length
        ? `
          <h4 class="mt-4 text-sm font-semibold">Symptom checks</h4>
          <ul class="mt-1 space-y-1 text-sm">
            ${symptoms.map(item => `
              <li>
                ${esc(item.title)}
                ${item.level ? " (doctor visit advised)" : ""}
              </li>
            `).join("")}
          </ul>
        `
        : ""
    }
  `;
}

function calStep(amount) {
  const view = calView;

  if (view.mode === "year") {
    view.y += amount;
  } else {
    view.m += amount;

    if (view.m < 0) {
      view.m = 11;
      view.y--;
    }

    if (view.m > 11) {
      view.m = 0;
      view.y++;
    }
  }

  renderCal(false);
}

$("#calPrev").addEventListener("click", () => calStep(-1));
$("#calNext").addEventListener("click", () => calStep(1));

$("#calendar").addEventListener("click", event => {
  const modeButton = event.target.closest("[data-calmode]");
  const monthButton = event.target.closest("[data-month]");
  const dateButton = event.target.closest("[data-date]");

  if (modeButton) {
    calView.mode = modeButton.dataset.calmode;
  } else if (monthButton) {
    calView.m = Number(monthButton.dataset.month);
    calView.mode = "month";
  } else if (dateButton) {
    calView.sel = dateButton.dataset.date;
  } else {
    return;
  }

  renderCal(false);
});

/* ---------- Application startup ---------- */

(async function init() {
  // Start by hiding the dashboard until authentication is checked.
  document.body.classList.add("auth-locked");

  let reachable = false;

  try {
    reachable = await Auth.load();

    if (Auth.cur) {
      // A valid server session already exists.
      document.body.classList.remove("auth-locked");
    }

    await afterAuth();

    if (!Auth.cur) {
      openAuth("up");
    }
  } catch (error) {
    console.error("Ayuva initialization error:", error);

    $("#authMsg").textContent =
      "Could not connect to Ayuva. Check that the backend is running at http://localhost:3001.";

    openAuth("up");
  }

  if (!reachable) {
    $("#authMsg").textContent =
      "Ayuva's server could not be reached. Check that the backend is running, then reload this page.";
  }

  loadRemedies();

  bubble(
    "Namaste. Tell me what is bothering you. " +
    "If anything sounds like an emergency, seek medical care immediately."
  );

  setOpts(TOPIC_LABELS);
})();

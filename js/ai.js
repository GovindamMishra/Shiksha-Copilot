class ShikshaAI {
  constructor(config) { this.config = {...config}; }
  setConfig(next) { this.config = {...this.config,...next}; window.SHIKSHA_CONFIG = this.config; }
  async request(action, payload = {}, context = {}, history = []) {
    const base = (this.config.backendUrl || "http://localhost:8787").replace(/\/$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs || 120000);
    try {
      const res = await fetch(`${base}/api/ai`, {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({action, payload, context, history}), signal: controller.signal
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || `AI request failed (${res.status})`);
      if (data.notice) window.dispatchEvent(new CustomEvent("shiksha:notice", {detail:{message:data.notice,mode:data.mode||data.provider||"demo"}}));
      return data;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("Gemini request timed out. Check your internet connection and backend server.");
      throw e;
    } finally { clearTimeout(timer); }
  }
  async ask(message, context, history=[]) { return (await this.request("ask", {message}, context, history)).result; }
  async generateNotes(topic, context) { return (await this.request("notes", {topic}, context)).result; }
  async syllabusNotes(context) { return (await this.request("syllabus-notes", {}, context)).result; }
  async quickRevision(topic, context) { return (await this.request("quick-revision", {topic}, context)).result; }
  async flashcards(topic, context) { return (await this.request("flashcards", {topic}, context)).result; }
  async quiz(topic, context, count=5, difficulty="adaptive") { return (await this.request("quiz", {topic,count,difficulty}, context)).result; }
  async adaptiveQuiz(context) { return (await this.request("adaptive-quiz", {}, context)).result; }
  async adaptiveNext(payload, context) { return (await this.request("adaptive-next", payload, context)).result; }
  async evaluate(question,answer,expectedAnswer,context) { return (await this.request("evaluate", {question,answer,expectedAnswer}, context)).result; }
  async studyPlan(days,context) { return (await this.request("study-plan", {days}, context)).result; }
  async readiness(context) { return (await this.request("readiness", {}, context)).result; }
  async analyze(context) { return (await this.request("analyze", {}, context)).result; }
  async nextAction(context) { return (await this.request("next-action", {}, context)).result; }
  async importSyllabus(filename, contentBase64) {
    const base=(this.config.backendUrl||"http://localhost:8787").replace(/\/$/,"");
    const res=await fetch(`${base}/api/syllabus/import`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({filename,contentBase64})});
    const data=await res.json().catch(()=>({})); if(!res.ok||!data.ok)throw new Error(data.error||"Could not extract syllabus text"); return data;
  }
  async parseSyllabus(text) {
    const base = (this.config.backendUrl || "http://localhost:8787").replace(/\/$/, "");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs || 120000);
    try {
      const res = await fetch(`${base}/api/syllabus/parse`, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({text}), signal:controller.signal});
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || "Syllabus parsing failed.");
      return data.syllabus;
    } catch(e) {
      if(e.name === "AbortError") throw new Error("Syllabus processing timed out. Check the backend and internet connection.");
      throw e;
    } finally { clearTimeout(timer); }
  }
  async health() {
    const base=(this.config.backendUrl||"http://localhost:8787").replace(/\/$/,"");
    const res=await fetch(`${base}/api/health`); return await res.json();
  }
  async loadState() {
    const base=(this.config.backendUrl||"http://localhost:8787").replace(/\/$/,"");
    const res=await fetch(`${base}/api/state`); const data=await res.json(); if(!res.ok||!data.ok) throw new Error(data.error||"Could not load saved learning state"); return data.state;
  }
  async saveState(state) {
    const base=(this.config.backendUrl||"http://localhost:8787").replace(/\/$/,"");
    const res=await fetch(`${base}/api/state`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(state)}); const data=await res.json(); if(!res.ok||!data.ok) throw new Error(data.error||"Could not save learning state"); return data.state;
  }
}
window.shikshaAI = new ShikshaAI(window.SHIKSHA_CONFIG || {backendUrl:"http://localhost:8787"});

import './core.js';

/**
 * TWSE Trim Action Radar UI Wrapper
 * Embeds the isolated Tailwind + ECharts war-room via same-origin iframe
 * while sharing Local-First cache & Headless AgentBridge via core.js.
 */
export class TwseRadarUI {
  constructor() {
    this._boundMsgHandler = null;
  }

  render(container, _state, _store, showToast) {
    container.innerHTML = `
      <div class="radar-iframe-shell">
        <iframe
          id="twse-radar-iframe"
          src="./tools/twse-radar/radar.html?v=${encodeURIComponent(window.NIC_APP_VERSION || 'v18')}"
          title="TWSE 減碼行動雷達 v3.0"
          class="radar-iframe"
          loading="eager"
        ></iframe>
      </div>
    `;

    if (this._boundMsgHandler) {
      window.removeEventListener('message', this._boundMsgHandler);
    }
    this._boundMsgHandler = (ev) => {
      if (ev.origin !== window.location.origin) return;
      if (ev.data && ev.data.type === 'nic-twse-radar-updated' && ev.data.summary) {
        if (typeof window.NIC_OnRadarUpdated === 'function') {
          window.NIC_OnRadarUpdated(ev.data.summary);
        }
      }
    };
    window.addEventListener('message', this._boundMsgHandler);
  }
}

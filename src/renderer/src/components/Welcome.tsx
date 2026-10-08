import { BookOpen, ChevronRight, MessageCircle, Plus, Sparkles, StickyNote } from 'lucide-react';
import type { ReactNode } from 'react';
export default function Welcome({ onImport, onDemo, generalChat }: {
    onImport: () => void;
    onDemo: () => void;
    generalChat?: ReactNode;
}) {
    return (<div className={`welcome${generalChat ? ' has-general-chat' : ''}`}>
    <div className="welcome-top">
    <span>YOUR PERSONAL RESEARCH SPACE</span>
    <div className="local-tag">
    <span />Saved on this device</div>
    </div>
    <div className="welcome-content">
    <div className="welcome-copy">
    <span className="eyebrow">LESS FRICTION. MORE UNDERSTANDING.</span>
    <h1>Your reading,<br />in <em>focus.</em>
    </h1>
    <p>Bring your papers, questions, and ideas together.<br />A calm space to read deeply and think clearly.</p>
    <div className="welcome-actions">
    <button className="primary-button" onClick={onImport}>
    <Plus size={17}/>Import your first PDF</button>
    <button className="demo-button" onClick={onDemo}>Explore the demo<ChevronRight size={15}/>
    </button>
    </div>
    <span className="welcome-hint">Your files stay local. Your notes stay yours.</span>
    </div>
    {generalChat ? <div className="welcome-chat-slot">{generalChat}</div> : <div className="paper-illustration" aria-hidden="true">
    <div className="illustration-sheet back-sheet"/>
    <div className="illustration-sheet front-sheet">
    <div className="tiny-journal">THE READING ROOM <span>01 / 2026</span>
    </div>
    <div className="illustration-title">Small questions.<br />Deeper understanding.</div>
    <div className="illustration-line long"/>
    <div className="illustration-line"/>
    <div className="illustration-columns">
    <div>{Array.from({ length: 8 }, (_, i) => <i key={i}/>)}</div>
    <div>{Array.from({ length: 8 }, (_, i) => <i key={i}/>)}</div>
    </div>
    <div className="illustration-chart">
    <span />
    <span />
    <span />
    <span />
    </div>
    <div className="illustration-foot">A place for the ideas that matter.</div>
    </div>
    <div className="floating-note">
    <Sparkles size={16}/>
    <span>Make room<br />
    <strong>for a new idea.</strong>
    </span>
    </div>
    <div className="floating-context">
    <span />Read. Question. Connect.</div>
    </div>}
    </div>
    <div className="welcome-features">
    <div>
    <span className="feature-icon">
    <BookOpen size={20}/>
    </span>
    <strong>Read with context</strong>
    <p>Keep the original paper<br />at the center of your work.</p>
    </div>
    <div>
    <span className="feature-icon">
    <MessageCircle size={20}/>
    </span>
    <strong>Ask better questions</strong>
    <p>Discuss a passage or a page<br />with your own AI connection.</p>
    </div>
    <div>
    <span className="feature-icon">
    <StickyNote size={20}/>
    </span>
    <strong>Think in your words</strong>
    <p>Capture notes that travel<br />with each paper.</p>
    </div>
    </div>
    <div className="welcome-footer">BUILT FOR CURIOUS MINDS<span>PDF reading · Local notes · DeepSeek</span>
    </div>
    </div>);
}

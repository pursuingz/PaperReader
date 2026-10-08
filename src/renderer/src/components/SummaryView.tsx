import { summaryCards } from '../data/demo';
export default function SummaryView() {
    return (<>
    <div className="summary-heading">
    <div>
    <span className="eyebrow">THE BIG PICTURE</span>
    <h2>A paper, at a glance.</h2>
    </div>
    <span className="demo-badge">ILLUSTRATIVE SUMMARY</span>
    </div>
    <div className="summary-cards">{summaryCards.map(([title, content], index) => <article key={title} className={`summary-card card-${index}`}>
        <h3>
        <span>{['⌘', '▤', '☼', '⚙', '▥', '◇', '✧', '▧'][index]}</span>{title}</h3>
        <p>{content}</p>{index === 0 && <div className="keyword-tags">
            <span>Evidence</span>
            <span>Reading</span>
            <span>Context</span>
            </div>}</article>)}</div>
    </>);
}

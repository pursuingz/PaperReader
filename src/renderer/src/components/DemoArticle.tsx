export default function DemoArticle() {
    return <article className="demo-article">
    <div className="article-rule"/>
    <p className="article-overline">ORIGINAL DEMONSTRATION · PRODUCT WALKTHROUGH</p>
    <h1>Reading with context:<br />a research workspace</h1>
    <p className="article-author">Paper Reader · An illustrative sample</p>
    <div className="article-rule"/>
    <h3>Abstract</h3>
    <p className="abstract">A paper is more than a sequence of pages. Reading involves returning to claims, comparing evidence and recording questions. A useful workspace keeps the source, an interpretation and the reader’s own notes close together. This original sample explores that workflow; it does not report scientific results.</p>
    <div className="article-columns">
    <section>
    <h3>1 &nbsp; A deliberate reading workflow</h3>
    <p>Start with the question that brought you to the document. Read the abstract and identify the scope of the argument. Separate the author’s statements from your own interpretations.</p>
    <p>Good questions are specific. Instead of asking for everything at once, pause at a sentence that carries the argument forward. What is being claimed? What evidence would establish that claim?</p>
    <h3>2 &nbsp; Keeping context visible</h3>
    <p>A selected passage is a precise point of departure for discussion. The current page supplies nearby context. Ask how a claim is supported, what a term means, or how the passage connects to an earlier idea.</p>
    <p>
    <mark>Keep the source visible while you form your interpretation.</mark> An assistant’s explanation should invite a return to the text, especially when the wording is uncertain.</p>
    </section>
    <section>
    <div className="article-figure">
    <span>Source passage</span>
    <i>↓</i>
    <div>
    <span>Focused question</span>
    <span>Personal note</span>
    </div>
    <p>Figure 1. An illustrative reading loop.</p>
    </div>
    <h3>3 &nbsp; Notes as a working record</h3>
    <p>Record a claim, its location, and the question it raises. Notes are an evolving record, not a replacement for the source. A short note written in your own words is often easier to revisit than a long copied passage.</p>
    <h3>4 &nbsp; Boundaries</h3>
    <p>The examples in this article are illustrative. No experiments, datasets or performance claims are reported. Imported PDF files retain their original content, and your notes remain separate from the document.</p>
    </section>
    </div>
    <footer>DEMO PAPER — ORIGINAL SAMPLE CONTENT <span>1</span>
    </footer>
    </article>;
}

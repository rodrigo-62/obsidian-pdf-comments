// Multi-page essay: headings (outline), footnotes, internal links, a paragraph across a page break.
#set document(title: "A Short History of Lighthouses")
#set page(paper: "a5", margin: 2cm, numbering: "1")
#set text(size: 11pt, hyphenate: true, lang: "en")
#set par(justify: true)
#set heading(numbering: none)
#let v2 = sys.inputs.at("version", default: "1") == "2"

#align(center)[#text(size: 18pt, weight: "bold")[A Short History of Lighthouses] \ #text(style: "italic")[Light at the Edge of the Map]]

#outline(title: "Contents")

= Introduction: Light and Distance <intro>

For as long as ships have sailed close to land, sailors have needed to know where the land ends. A coastline that is obvious by day disappears at night, and a harbour entrance that is easy to find in calm weather becomes a trap in a storm. The earliest answer was simple: a fire on a hill#footnote[Coastal fires of this kind are mentioned in many old port descriptions; few of the sites survive.], kept burning by whoever lived nearest.

This essay asks two plain questions: how did a fire on a hill become a tower with a lens, and why did it take so long? The short answer is that a light is only useful if it can be seen far away and recognised for what it is. Both problems turned out to be harder than building the tower. The lens is discussed in #link(<lens>)[the section on the lens].

#if v2 [
  _Note to the second version:_ this paragraph was added in the revised edition, so every passage after it has moved. Comments made on the first version must be found again by their quoted text.
]

= I. Fires and towers

The first towers were little more than raised fireplaces. Wood and coal burned unevenly, smoke hid the flame, and a keeper had to climb the stairs every few hours to feed the fire. On a clear night such a light could be seen for a few miles; in rain, hardly at all.

Oil lamps were cleaner but weaker. Keepers tried polished metal behind the flame to throw the light forward, and for a while every new tower used a slightly larger mirror than the last. The improvement was real but small, because a mirror can only send back the light it receives.#footnote[Some towers burned whale oil, others rapeseed oil; the choice mostly depended on price.]

#quote(block: true, attribution: [an old harbour saying])[A light that cannot be told apart from the others is almost worse than no light.]

The saying explains why towers began to differ from each other: some flashed, some stayed steady, some changed colour. #lorem(160)

#lorem(120) This long paragraph is meant to run across a page break, so that a single comment can cover the end of one page and the start of the next. #lorem(140)

= II. The lens <lens>

The real change came with the stepped lens: rings of glass arranged so that almost all of the lamp's light leaves the tower as one narrow beam. A small flame behind a good lens could now be seen further than a large fire on an open hill.

+ The first effect was range: lights could be placed further from danger and still be useful.
+ The second was identity: each tower got its own pattern of flashes, printed on the charts.
+ The third was cost: lenses were expensive, so fewer, better towers replaced many small ones.

#lorem(180)

= III. Keepers and machines

For a long time every light needed a keeper. The work was regular and lonely: trimming wicks, winding the clockwork that turned the lens, cleaning soot from the glass every morning.#footnote[Cleaning mattered more than it sounds: a thin layer of soot could cut the range of a light by half.] Later, electric lamps and timers made the keepers unnecessary, and most towers today run on their own.

What has not changed is the purpose. A lighthouse still says the same three things it always said: here is the land, here is the danger, and this is which light I am. Back to the #link(<intro>)[introduction]. External reference: #link("https://example.org/lighthouses")[example.org].

= Conclusion

The history of the lighthouse is mostly a history of seeing further with less: less fuel, less labour, less guesswork for the people at sea.

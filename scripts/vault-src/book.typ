// A long book (~300 pages) for performance: 50 chapters with sections (outline).
#set document(title: "The Long Book of the Sea")
#set page(paper: "a5", margin: 2cm, numbering: "1")
#set text(size: 10.5pt, lang: "en")
#set par(justify: true)
#set heading(numbering: "1.1")
#outline(title: "Contents", depth: 1)
#for ch in range(1, 51) [
  #pagebreak(weak: true)
  = Chapter #ch: The #("North", "South", "East", "West").at(calc.rem(ch, 4)) Coast
  #for sec in range(1, 4) [
    == Section #sec
    #lorem(330 + calc.rem(ch * 37 + sec * 11, 120))

    #lorem(240)
  ]
]

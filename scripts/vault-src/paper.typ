// Two-column paper with an abstract, a figure, an equation and references.
#set document(title: "Beam Divergence in Stepped Lenses")
#set page(paper: "a4", margin: (x: 1.8cm, y: 2cm), numbering: "1", columns: 2)
#set text(size: 10pt, lang: "en")
#set par(justify: true)
#set heading(numbering: "1.")
#set math.equation(numbering: "(1)")

#place(top + center, float: true, scope: "parent", clearance: 1.5em)[
  #text(size: 16pt, weight: "bold")[Beam Divergence in Stepped Lenses] \
  #v(0.3em) A. Keeper#super[1], B. Fresnel#super[2] \
  #text(size: 8pt)[#super[1]Harbour Institute #h(1em) #super[2]Department of Optics] \
  #v(0.6em)
  #block(width: 85%)[#set align(left); *Abstract.* #lorem(90)]
]

= Introduction
#lorem(150) The divergence of the beam is given by @eq-div.

$ theta approx d / (2 f) $ <eq-div>

#lorem(110) See @fig-beam for the geometry.

#figure(
  rect(width: 100%, height: 4cm, fill: gradient.linear(yellow, orange))[#align(center + horizon)[#circle(radius: 0.6cm, fill: white)]],
  caption: [Geometry of a stepped lens and its beam.],
) <fig-beam>

= Method
#lorem(200)

= Results
#lorem(160)

#table(columns: 3, [*Lens*], [*Order*], [*Range (nm)*], [A], [1], [22], [B], [2], [18], [C], [3], [14])

#lorem(140)

= Discussion
#lorem(220)

= References
#set text(size: 8.5pt)
+ Keeper, A. (1901). On the range of coastal lights. _Journal of Harbours_, 3, 12–40.
+ Fresnel, B. (1822). Mémoire sur un nouveau système d'éclairage des phares.
+ #lorem(20)

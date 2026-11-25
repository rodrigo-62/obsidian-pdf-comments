// "Scanned" pages: shapes only, no text layer. For area comments.
#set page(paper: "a5", margin: 1.5cm)
#rect(width: 100%, height: 100%, fill: luma(235), stroke: none)[
  #for i in range(18) { place(top + left, dx: 0.5cm, dy: 1cm + i * 0.9cm, rect(width: 80% - calc.rem(i * 13, 30) * 1%, height: 0.35cm, fill: luma(90))) }
  #place(bottom + right, dx: -0.5cm, dy: -0.5cm, circle(radius: 1.5cm, fill: luma(150)))
]
#pagebreak()
#rect(width: 100%, height: 100%, fill: luma(240), stroke: none)[
  #place(center + horizon, polygon(fill: luma(120), (0cm, 4cm), (3cm, 0cm), (6cm, 4cm)))
]

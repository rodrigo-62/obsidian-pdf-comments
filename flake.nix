{
  description = "PDF Comments — margin comments on PDFs in Obsidian (dev shell)";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs_22 pkgs.git pkgs.typst pkgs.qpdf ];
          shellHook = ''
            echo "pdf-comments dev shell: node $(node --version)"
          '';
        };
      });
    };
}

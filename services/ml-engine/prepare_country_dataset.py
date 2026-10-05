"""Prepare country-scoped, legal, deduplicated ChessBase PGN exports."""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import chess.pgn
from game_identity import game_identity


def normalized(name):
    return ' '.join(name.casefold().split())


def prepare(inputs, roster, output, country='SRI'):
    players = json.loads(Path(roster).read_text(encoding='utf-8-sig'))['players']
    ids = {str(player['fide_id']):player for player in players if player.get('country') == country}
    names = collections.defaultdict(set)
    for fide_id, player in ids.items():
        for name in [player['name'], *player.get('aliases', [])]:
            names[normalized(name)].add(fide_id)
    coverage = collections.Counter(); unresolved = collections.Counter(); seen = set()
    totals = collections.Counter()
    target = Path(output)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Never replace a user's source export or previous prepared corpus.
    with target.open('x', encoding='utf8', newline='\n') as destination:
        for path in inputs:
            with Path(path).open(encoding='utf-8-sig') as source:
                while (game := chess.pgn.read_game(source)) is not None:
                    totals['read'] += 1
                    if game.errors or not any(game.mainline_moves()):
                        totals['invalid_or_empty'] += 1; continue
                    matched = set()
                    for side in ['White','Black']:
                        fide_id = game.headers.get(side+'FideId', '')
                        if fide_id in ids:
                            matched.add(fide_id)
                        elif game.headers.get(side+'Country', game.headers.get(side+'Federation', '')) == country:
                            matched.add('tag:'+normalized(game.headers.get(side, 'Unknown')))
                        elif not fide_id.isdigit() or int(fide_id) <= 0:
                            candidates = names[normalized(game.headers.get(side, 'Unknown'))]
                            if len(candidates) == 1: matched.update(candidates)
                            else: unresolved[game.headers.get(side, 'Unknown')] += 1
                    if not matched:
                        totals['without_confirmed_country'] += 1; continue
                    # Header edits and comments do not make the same game new evidence.
                    digest = game_identity(game)
                    if digest in seen:
                        totals['duplicates'] += 1; continue
                    seen.add(digest); coverage.update(matched); totals['included'] += 1
                    destination.write(game.accept(chess.pgn.StringExporter(headers=True,variations=False,comments=False))+'\n\n')
    report = {'country':country, 'scope':'Only supplied ChessBase PGN exports; completeness of ChessBase is not asserted',
        'totals':dict(totals), 'players':[{'fide_id':key, 'name':player['name'], 'games':coverage[key]}
            for key,player in sorted(ids.items(),key=lambda entry:entry[1]['name'])],
        'tag_confirmed_players':{key:value for key,value in coverage.items() if key.startswith('tag:')},
        'unresolved_names':dict(sorted(unresolved.items()))}
    target.with_suffix('.coverage.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pgn', nargs='+')
    parser.add_argument('--roster', required=True, help='Reviewed JSON players: fide_id, name, country, optional aliases')
    parser.add_argument('--output', required=True)
    parser.add_argument('--country', default='SRI')
    args = parser.parse_args()
    print(json.dumps(prepare(args.pgn,args.roster,args.output,args.country)['totals'],indent=2))

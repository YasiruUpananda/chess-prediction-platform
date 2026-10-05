"""Reviewed FIDE identities and explicit aliases, with provisional name identities."""
import argparse
import json
from pathlib import Path
from game_identity import normalized, participant_identity

def register_player(db, headers, side):
    original=headers.get(side,'Unknown')
    candidate=participant_identity(headers,side)
    aliases=db.execute('SELECT a.player_id,p.reviewed FROM player_aliases a JOIN players p ON p.id=a.player_id WHERE a.alias=%s',(normalized(original),)).fetchall()
    reviewed=[row for row in aliases if row[1]]
    if reviewed: aliases=reviewed
    if candidate.startswith('name:') and len(aliases)==1: candidate=aliases[0][0]
    fide=candidate.removeprefix('fide:') if candidate.startswith('fide:') else None
    db.execute('INSERT INTO players(id,name,fide_id,federation) VALUES (%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING',
        (candidate,original,fide,headers.get(side+'Country',headers.get(side+'Federation'))))
    db.execute('INSERT INTO player_aliases(player_id,alias) VALUES (%s,%s) ON CONFLICT DO NOTHING',(candidate,normalized(original)))
    return candidate

def register_game(db, game_id, game):
    for side,color in [('White','white'),('Black','black')]:
        identity=register_player(db,game.headers,side)
        db.execute('INSERT INTO game_participants(game_id,color,player_id,original_name) VALUES (%s,%s,%s,%s) '
            'ON CONFLICT(game_id,color) DO UPDATE SET player_id=EXCLUDED.player_id', (game_id,color,identity,game.headers.get(side,'Unknown')))
        db.execute('UPDATE player_moves SET player_id=%s WHERE game_id=%s AND color=%s',(identity,game_id,color))
        db.execute('UPDATE langchain_pg_embedding SET cmetadata=coalesce(cmetadata,\'{}\'::jsonb) || jsonb_build_object(%s::text,%s::text) WHERE id=%s',
          (color+'_id',identity,game_id))

def import_roster(path):
    from database import connect
    players=json.loads(Path(path).read_text(encoding='utf-8-sig'))['players']
    with connect() as db:
        for player in players:
            identity='fide:'+str(player['fide_id'])
            db.execute('INSERT INTO players(id,name,fide_id,federation,reviewed) VALUES (%s,%s,%s,%s,true) '
                'ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,federation=EXCLUDED.federation,reviewed=true',
                (identity,player['name'],str(player['fide_id']),player.get('country')))
            for alias in [player['name'],*player.get('aliases',[])]:
                value=normalized(alias)
                db.execute('INSERT INTO player_aliases(player_id,alias) VALUES (%s,%s) ON CONFLICT DO NOTHING',(identity,value))
        # Only unambiguous, reviewed aliases promote provisional participants.
        db.execute("""UPDATE game_participants g SET player_id=a.player_id FROM player_aliases a JOIN players p ON p.id=a.player_id
          WHERE p.reviewed AND g.player_id LIKE 'name:%' AND lower(trim(g.original_name))=a.alias
          AND (SELECT count(*) FROM player_aliases b JOIN players r ON r.id=b.player_id WHERE b.alias=a.alias AND r.reviewed)=1""")
        db.execute('UPDATE player_moves m SET player_id=g.player_id FROM game_participants g WHERE m.game_id=g.game_id AND m.color=g.color')
        for color in ['white','black']:
            db.execute('UPDATE langchain_pg_embedding e SET cmetadata=coalesce(e.cmetadata,\'{}\'::jsonb) || jsonb_build_object(%s::text,g.player_id) FROM game_participants g WHERE g.game_id=e.id AND g.color=%s',(color+'_id',color))
        db.execute('UPDATE dataset_version SET version=version+1 WHERE id=1')
    return len(players)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('roster');args=parser.parse_args()
    print('Reviewed players:',import_roster(args.roster))

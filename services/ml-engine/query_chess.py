"""Player-scoped CLI; arbitrary unfiltered searches are retired."""
import argparse
from predict_opponent import factual_statistics, supporting_games

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('player');parser.add_argument('--context',default='');args=parser.parse_args()
    _,ids,_=factual_statistics(args.player.strip().lower())
    for game in supporting_games(args.player.strip().lower(),args.context,ids):
        print(game['id'],game['white'],'vs',game['black']);print(game['pgn'])

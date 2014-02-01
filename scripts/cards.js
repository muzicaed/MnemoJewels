mj.modules.cards = (function() {

    var game = null;
    var db = null;
    var Pair = null;
    var allCards = null;
    var wordMappings = null;
    var TimeMeter = null;

    var Time = {
        SECOND:             1000,
        MINUTE:        60 * 1000,
        HOUR:     60 * 60 * 1000,
        DAY: 24 * 60 * 60 * 1000
    };
    
    var States = {
        NEW:      1,
        LEARNING: 2,
        KNOWN:    3,
        LAPSE:    4
    };

    function setup() {
        game = mj.modules.game;
        db = mj.modules.database;
        Pair = mj.classes.Pair;
        TimeMeter = mj.modules.debug.TimeMeter;

        allCards = {};
        wordMappings = {};
        db.loadAllCards(function(cards){
            for (var i = 0; i < cards.length; i++) {
                var pair = new Pair(cards[i]);
                allCards[pair.fiPairId] = pair;
                if (wordMappings[pair.fsFront]) {
                    if (wordMappings[pair.fsFront].indexOf(pair.fsBack) == -1) {
                        wordMappings[pair.fsFront].push(pair.fsBack);
                    }
                } else {
                    wordMappings[pair.fsFront] = [pair.fsBack];
                }
                //console.log(pair.toString());
            }
        });
    }
    
    function conflicts(poPair, paPairsInUse) {
        for (var i = 0; i < paPairsInUse.length; i++) {
            if (cardsConflict(poPair, paPairsInUse[i])) {
                return true;
            }
        }
        return false;
    }

    function cardsConflict(card1, card2) {
        return card1.fsFront == card2.fsFront
            || card1.fsBack == card2.fsBack
            || wordMappings[card1.fsFront].indexOf(card2.fsBack) >= 0
            || wordMappings[card2.fsFront].indexOf(card1.fsBack) >= 0
    }

    function choosePairsForGroup(piSize, paPairsInUse, paNextCards) {
        var group = [];
        var pairsByPriority = [];
        var i, pair, priority;

        // First card from a group is chosen according to the schedule
        while (group.length == 0 && paNextCards.length > 0) {
            pair = allCards[paNextCards.shift()];
            if (!conflicts(pair, paPairsInUse)) {
                group.push(pair);
            }
        }

        // Remaining cards are prioritized according to state and Levenshtein distance to the 1st card
        for (i = 0; i < paNextCards.length; i++) {
            pair = allCards[paNextCards[i]];
            if (!conflicts(pair, paPairsInUse) && !conflicts(pair, group)) {
                priority = Math.min(levenshtein(pair.fsFront, group[0].fsFront), levenshtein(pair.fsBack, group[0].fsFront));
                switch (pair.fiState) {
                    case States.LAPSE:    priority += 100; break;
                    case States.NEW:      priority += 200; break;
                }
                pairsByPriority[priority] = pairsByPriority[priority] || [];
                pairsByPriority[priority].push(pair);
            }
        }

        // Take the cards with highest priority (smaller value)
        for (priority = 1; priority < pairsByPriority.length; priority++) {
            if (pairsByPriority[priority]) {
                for (i = 0; i < pairsByPriority[priority].length; i++) {
                    pair = pairsByPriority[priority][i];
                    if (!conflicts(pair, group)) {
                        group.push(pair);
                        if (group.length == piSize) break;
                    }
                }
                if (group.length == piSize) break;
            }
        }

        console.dir({
            pairsByPriority: pairsByPriority,
            group: group,
            paPairsInUse: paPairsInUse
        });

        return group;
    }

    function loadCards(piSize, paPairsInUse, pcCallback, cardsToLoad) {
        db.loadNextCards(cardsToLoad, function(paNextCards) {
            var cardsLoaded = paNextCards.length;
            TimeMeter.start('CP');
            var group = choosePairsForGroup(piSize, paPairsInUse, paNextCards);
            TimeMeter.stop('CP');
            if (group.length == piSize) {
                pcCallback(group);
                console.groupEnd();
            } else if (cardsLoaded < cardsToLoad) {
                alert('There are not enough cards. Try importing a few more.');
                // TODO: handle this situation properly
            } else {
                loadCards(piSize, paPairsInUse, pcCallback, cardsToLoad * 2);
            }
        });
    }

    function createNewGroup(piSize, paPairsInUse, pcCallback) {
        var cardsToLoad = piSize * game.getScopeSize();
        loadCards(piSize, paPairsInUse, pcCallback, cardsToLoad);
    }
    
    function rescheduleMatch(piPairId, paPairsInGroup, piThinkingTime) {
        console.group('rescheduleMatch');
        console.dir({
            'piPairId': piPairId,
            'paPairsInGroup': paPairsInGroup,
            'piThinkingTime': piThinkingTime
        });
        if (paPairsInGroup.length > 1) {
            var moPair = allCards[piPairId];
            var now = Date.now();
            var minInterval = (paPairsInGroup.length * 1000 / piThinkingTime * Time.DAY);

            if (moPair.fdLastRep) {
                var scheduledInterval = moPair.fdNextRep - moPair.fdLastRep;
                var actualInterval = now - moPair.fdLastRep;
                var multiplier = moPair.ffEasiness * (paPairsInGroup.length - 1) / 2;
                var nextInterval = Math.max(minInterval, multiplier * actualInterval, scheduledInterval * 1.1);
                moPair.fdNextRep = Math.floor(moPair.fdLastRep + nextInterval);
                console.dir({
                    scheduledInterval: scheduledInterval,
                    actualInterval: actualInterval,
                    multiplier: multiplier,
                    fdLastRep: new Date(moPair.fdLastRep),
                    fdNextRep: new Date(moPair.fdNextRep)
                });
                // moPair.ffEasiness = ? // TODO
            } else {
                moPair.fdNextRep = Math.floor(now + minInterval);
            }
            console.log('fdNextRep: ' + new Date(moPair.fdNextRep));
            moPair.fdLastRep = now;

            if (moPair.fiState == States.NEW) {
                moPair.fiState = States.LEARNING;
            } else {
                moPair.fiState = States.KNOWN;
            }

            db.updateCard(moPair);
        }
        console.groupEnd();
    }
    
    function rescheduleMismatch(paMismatchedPairs, paPairsInGroup, piThinkingTime) {
        console.group('rescheduleMismatch');
        console.dir({
            'paMismatchedPairs': paMismatchedPairs,
            'paPairsInGroup': paPairsInGroup,
            'piThinkingTime': piThinkingTime
        });
        var now = Date.now();
        var nextRep = now + 2 * Time.MINUTE;
        for (var m = 0; m < paMismatchedPairs.length; m++) {
            var moPair = allCards[paMismatchedPairs[m]];
            moPair.fdNextRep = nextRep;
            moPair.fdLastRep = now;
            if (moPair.fiState == States.NEW || moPair.fiState == States.LEARNING) {
                moPair.fiState = States.NEW;
            } else {
                moPair.fiState = States.LAPSE;
            }
            db.updateCard(moPair);
        }
        console.groupEnd();
    }
    
    // http://kevin.vanzonneveld.net
    // +            original by: Carlos R. L. Rodrigues (http://www.jsfromhell.com)
    // +            bugfixed by: Onno Marsman
    // +             revised by: Andrea Giammarchi (http://webreflection.blogspot.com)
    // + reimplemented by: Brett Zamir (http://brett-zamir.me)
    // + reimplemented by: Alexander M Beedie
    // *                example 1: levenshtein('Kevin van Zonneveld', 'Kevin van Sommeveld');
    // *                returns 1: 3
    function levenshtein (s1, s2) {
        if (s1 == s2) {
            return 0;
        }
        var s1_len = s1.length;
        var s2_len = s2.length;
        if (s1_len === 0) {
            return s2_len;
        }
        if (s2_len === 0) {
            return s1_len;
        }
        var v0 = new Array(s1_len + 1);
        var v1 = new Array(s1_len + 1);
        var s1_idx, s2_idx, cost = 0;
        for (s1_idx = 0; s1_idx < s1_len + 1; s1_idx++) {
            v0[s1_idx] = s1_idx;
        }
        var char_s1 = '',
            char_s2 = '';
        for (s2_idx = 1; s2_idx <= s2_len; s2_idx++) {
            v1[0] = s2_idx;
            char_s2 = s2[s2_idx - 1];
            for (s1_idx = 0; s1_idx < s1_len; s1_idx++) {
                char_s1 = s1[s1_idx];
                cost = (char_s1 == char_s2) ? 0 : 1;
                var m_min = v0[s1_idx + 1] + 1;
                var b = v1[s1_idx] + 1;
                var c = v0[s1_idx] + cost;
                if (b < m_min) {
                    m_min = b;
                }
                if (c < m_min) {
                    m_min = c;
                }
                v1[s1_idx + 1] = m_min;
            }
            var v_tmp = v0;
            v0 = v1;
            v1 = v_tmp;
        }
        return v0[s1_len];
    }

    return {
        setup : setup,
        createNewGroup : createNewGroup,
        rescheduleMatch : rescheduleMatch,
        rescheduleMismatch : rescheduleMismatch
    };
})();

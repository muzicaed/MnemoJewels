var mj = {
    modules : {},
    classes : {},
    screens : {},
    settings : {
        NUM_ROWS : 10,
        DEFAULT_GROUP_SIZE : 3,
        TIME_FOR_NEXT_GROUP : 5000,
        controls : {
            CLICK : 'selectJewel',
            TOUCH : 'selectJewel'
        }
    }
};

window.addEventListener('load', function() {
    
    Modernizr.addTest("standalone", function() {
        return (window.navigator.standalone != false);
    });
    
    // loading stage 1
    Modernizr.load([
        {
            load : [
                "scripts/lib/sizzle.js",
                "scripts/dom.js",
                "scripts/game.js",
                "scripts/screen.game_classic.js"
            ]
        },{
            test : Modernizr.standalone,
            yep : "scripts/screen.splash.js",
            nope : "scripts/screen.install.js",
            complete : function() {
                mj.modules.game.setup();
                if (Modernizr.standalone) {
                    mj.modules.game.navigateTo("splash-screen");
                } else {
                    mj.modules.game.navigateTo("install-screen");
                }
            }
        }
    ]);
    
    // loading stage 2
    if (Modernizr.standalone) {
        Modernizr.load([
        {
            load : [
                "scripts/classes.js",
                "scripts/board.js",
                "scripts/cards.js",
                "scripts/display.js",
                "scripts/input.js"
            ],
            complete : function() {
                for (var i in mj.modules) {
                    if (mj.modules[i].setup) {
                        mj.modules[i].setup();
                    }
                }
            }
        }
        ]);
    }
    
}, false);
